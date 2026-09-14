from __future__ import annotations

import argparse
import random
from pathlib import Path

import numpy as np
import torch

from tichu_env.cards import Card, Rank, Suit
from tichu_env.combinations import BOMB_TYPES, Combo, ComboType
from tichu_env.env import StepResult, TichuEnv
from tichu_env.state import PARTNER, GameState, Phase

from agents.policy_network import TichuPolicyValueNet
from eval.arena import (
    SeatChooser,
    _resolve_checkpoint,
    advanced_heuristic_chooser,
    heuristic_chooser,
    load_checkpoint,
    policy_chooser,
)

DEFAULT_CHECKPOINT_DIR = Path("checkpoints/run1")
DEFAULT_OUTPUT_DIR = Path("game_logs")

SUIT_NAMES = {Suit.SWORD: "검", Suit.PAGODA: "탑", Suit.JADE: "옥", Suit.STAR: "별"}
RANK_NAMES = {
    Rank.DOG: "개",
    Rank.MAHJONG: "마작",
    Rank.TWO: "2",
    Rank.THREE: "3",
    Rank.FOUR: "4",
    Rank.FIVE: "5",
    Rank.SIX: "6",
    Rank.SEVEN: "7",
    Rank.EIGHT: "8",
    Rank.NINE: "9",
    Rank.TEN: "10",
    Rank.JACK: "J",
    Rank.QUEEN: "Q",
    Rank.KING: "K",
    Rank.ACE: "A",
    Rank.PHOENIX: "불사조",
    Rank.DRAGON: "용",
}
COMBO_TYPE_NAMES = {
    ComboType.SINGLE: "싱글",
    ComboType.DOG: "개",
    ComboType.PAIR: "페어",
    ComboType.TRIPLE: "트리플",
    ComboType.FULL_HOUSE: "풀하우스",
    ComboType.STRAIGHT: "스트레이트",
    ComboType.PAIR_STRAIGHT: "페어 스트레이트",
    ComboType.BOMB_QUAD: "포카드 봄",
    ComboType.BOMB_STRAIGHT_FLUSH: "스트레이트 플러시 봄",
}


def card_str(card: Card) -> str:
    if card.suit is Suit.SPECIAL:
        return RANK_NAMES[card.rank]
    return f"{SUIT_NAMES[card.suit]}{RANK_NAMES[card.rank]}"


def cards_str(cards: tuple[Card, ...]) -> str:
    ordered = sorted(cards, key=lambda c: (c.rank.value, c.suit.value))
    return ", ".join(card_str(c) for c in ordered)


def _score_actions(network: TichuPolicyValueNet, result: StepResult) -> list[tuple[Combo | bool | None, float, float]]:
    """Scores every legal action for `result`'s current player under `network`.
    Returns (combo, logit, probability) triples sorted best-first by logit."""
    combos = [combo for combo, _ in result.legal_actions]
    action_vectors = torch.as_tensor(np.stack([vec for _, vec in result.legal_actions]), dtype=torch.float32)
    obs = torch.as_tensor(result.observation, dtype=torch.float32)
    with torch.no_grad():
        output = network(obs, action_vectors)
    logits = output.action_logits.tolist()
    probs = torch.softmax(output.action_logits, dim=-1).tolist()
    scored = list(zip(combos, logits, probs))
    scored.sort(key=lambda item: item[1], reverse=True)
    return scored


def _action_label(action: Combo | bool | None) -> str:
    if isinstance(action, bool):
        return "라지 티츄 콜" if action else "라지 티츄 포기"
    if action is None:
        return "패스"
    return f"{cards_str(action.cards)} ({COMBO_TYPE_NAMES[action.combo_type]})"


def narrate_round(
    env: TichuEnv,
    seat_choosers: dict[int, SeatChooser],
    seat_labels: dict[int, str],
    scoring_networks: dict[int, TichuPolicyValueNet],
    team_tags: dict[int, str],
) -> list[str]:
    """Plays one round to completion and returns a Korean natural-language
    narration of every action, trick resolution, and the final round result.

    `scoring_networks` maps each seat to the network used to score *that seat's*
    legal actions -- when both sides are trained checkpoints, each seat is scored
    by its own network (its own honest evaluation of its own options); when the
    opponent is the heuristic bot, every seat is scored by the one checkpoint
    under test, since the heuristic has no network of its own."""
    lines: list[str] = []
    result = env.reset()

    lines.append("## 초기 8장 손패 (라지 티츄 결정 전)")
    for seat in range(4):
        lines.append(f"- {seat_labels[seat]}: {cards_str(env.state.hands[seat])}")
    lines.append("")
    lines.append("## 진행")

    turn_no = 0
    while not result.done:
        state_before = env.state
        player = result.player
        is_leading = state_before.current_best is None

        scored_actions = _score_actions(scoring_networks[player], result)
        combo = seat_choosers[player](result)
        turn_no += 1

        lines.append(
            f"{turn_no}. [{seat_labels[player]}] 차례 -- 선택 가능한 액션 {len(scored_actions)}개 "
            "(정책망 점수 기준 내림차순, logit/확률):"
        )
        for candidate_combo, logit, prob in scored_actions:
            marker = " <- 실제 선택" if candidate_combo == combo else ""
            lines.append(f"    - {_action_label(candidate_combo)} : logit={logit:+.3f}, prob={prob:.1%}{marker}")
        lines.append(f"    => {_describe_action(combo, is_leading)}")

        result = env.step(combo)
        state_after = env.state

        for extra in _describe_aftermath(state_before, state_after, combo, seat_labels):
            lines.append(f"    -> {extra}")

        if state_before.phase is not Phase.PLAYING and state_after.phase is Phase.PLAYING:
            lines.append("")
            lines.append("## 카드 교환 후 시작 손패")
            for seat in range(4):
                lines.append(f"- {seat_labels[seat]}: {cards_str(state_after.hands[seat])}")
            lines.append("")

    lines.append("")
    lines.extend(_describe_round_end(env.state, result.info["team_scores"], seat_labels, team_tags))
    return lines


def _describe_action(combo: Combo | bool | None, is_leading: bool) -> str:
    if isinstance(combo, bool):
        return "라지 티츄를 선언합니다!" if combo else "라지 티츄를 선언하지 않습니다."
    if combo is None:
        return "패스합니다."
    combo_name = COMBO_TYPE_NAMES[combo.combo_type]
    card_text = cards_str(combo.cards)
    if combo.combo_type is ComboType.DOG:
        return f"{card_text}을(를) 내며 트릭을 리드합니다 (파트너에게 리드가 넘어갑니다)."
    if is_leading:
        return f"{card_text}을(를) 내며 트릭을 리드합니다 (조합: {combo_name})."
    if combo.combo_type in BOMB_TYPES:
        return f"{card_text}로 폭탄을 터뜨리며 끼어듭니다 (조합: {combo_name})."
    return f"{card_text}을(를) 내며 받아칩니다 (조합: {combo_name})."


def _describe_aftermath(
    state_before: GameState, state_after: GameState, combo: Combo | bool | None, seat_labels: dict[int, str]
) -> list[str]:
    notes: list[str] = []

    if isinstance(combo, bool):
        return notes

    if combo is not None and combo.combo_type is ComboType.DOG:
        notes.append(f"카드 없이 트릭이 종료되고, 리드가 {seat_labels[state_after.trick_leader]}에게 넘어갑니다.")
    elif state_before.trick_cards and not state_after.trick_cards:
        recipient = next(
            (i for i in range(4) if len(state_after.collected_tricks[i]) > len(state_before.collected_tricks[i])),
            None,
        )
        if recipient is not None:
            won_cards = state_after.collected_tricks[recipient][len(state_before.collected_tricks[recipient]) :]
            trick_points = sum(c.point_value for c in won_cards)
            actual_winner = state_before.last_player_to_act
            if actual_winner is not None and actual_winner != recipient:
                notes.append(
                    f"{seat_labels[actual_winner]}이(가) 용으로 트릭을 이겼지만, 규칙에 따라 자동으로 "
                    f"{seat_labels[recipient]}에게 트릭을 넘깁니다 (트릭 점수 {trick_points}점)."
                )
            else:
                notes.append(f"{seat_labels[recipient]}이(가) 트릭을 가져갑니다 (트릭 점수 {trick_points}점).")

    newly_finished = [p for p in state_after.finished_order if p not in state_before.finished_order]
    for player in newly_finished:
        rank = state_after.finished_order.index(player) + 1
        notes.append(f"{seat_labels[player]}이(가) 손패를 모두 내고 {rank}등으로 라운드에서 빠집니다!")

    return notes


def _describe_round_end(
    state: GameState, team_scores: tuple[int, int], seat_labels: dict[int, str], team_tags: dict[int, str]
) -> list[str]:
    lines = ["## 라운드 종료"]
    finished = list(state.finished_order)
    fourth = next(p for p in range(4) if p not in finished)
    double_win = len(finished) == 2 and PARTNER[finished[0]] == finished[1]

    if double_win:
        lines.append(
            f"- 더블 아웃: {seat_labels[finished[0]]}과(와) 파트너 {seat_labels[finished[1]]}이(가) "
            "상대팀보다 먼저 1등, 2등을 모두 차지해 라운드가 즉시 종료됐습니다."
        )
    else:
        ranking = finished + [fourth]
        ranking_text = ", ".join(f"{i + 1}등 {seat_labels[p]}" for i, p in enumerate(ranking))
        lines.append(f"- 순위: {ranking_text}")
        lines.append(
            f"- 4등 {seat_labels[fourth]}의 남은 손패({cards_str(state.hands[fourth])})는 상대팀에게 넘어갑니다."
        )

    lines.append(
        f"- 팀 점수(이번 라운드만): 0+2번 팀({team_tags[0]}) {team_scores[0]:+d}점, "
        f"1+3번 팀({team_tags[1]}) {team_scores[1]:+d}점"
    )
    lines.append(f"- {_describe_tichu_bonuses(state, seat_labels)}")
    return lines


def _describe_tichu_bonuses(state: GameState, seat_labels: dict[int, str]) -> str:
    first = state.finished_order[0] if state.finished_order else None
    large_callers = [p for p in range(4) if state.large_tichu_calls[p]]
    if not large_callers:
        return "그랜드 티츄 보너스: 없음 (아무도 콜하지 않았습니다). (소)티츄 콜은 이 환경에 아직 없어 항상 없음."

    results = ", ".join(
        f"{seat_labels[p]} {'성공 +200점' if p == first else '실패 -200점'}" for p in large_callers
    )
    return f"그랜드 티츄 보너스: {results}. (소)티츄 콜은 이 환경에 아직 없어 항상 없음."


def build_preamble(
    team_a_desc: str,
    team_b_desc: str,
    team_a_seats: tuple[int, int],
    team_b_seats: tuple[int, int],
    seed: int,
    opponent_is_policy: bool,
) -> list[str]:
    seat_labels = _seat_labels(team_a_seats)
    lines = [
        "# Tichu AI 테스트 게임 로그",
        "",
        f"- A팀({seat_labels[team_a_seats[0]]}, {seat_labels[team_a_seats[1]]}): {team_a_desc}",
        f"- B팀({seat_labels[team_b_seats[0]]}, {seat_labels[team_b_seats[1]]}): {team_b_desc}",
        "- 팀: 0번+2번 팀 vs 1번+3번 팀",
        f"- 시드: {seed}",
        "",
        "## 참고 (이 환경의 알려진 한계)",
        "- 그랜드 티츄 콜은 이제 학습 대상입니다(M2 Stage 1): 각 플레이어가 처음 받은 8장만 보고 직접 콜/포기를 "
        "결정하며, 전원 결정 후에만 나머지 6장이 합쳐집니다.",
        "- 카드 교환은 학습 대상이 아니라 휴리스틱 고정 규칙입니다: 파트너에게는 원칙적으로 가장 강한 카드(피닉스/"
        "용 우선, 없으면 가장 높은 카드)를 주지만 본인이 그랜드 티츄를 불렀다면 그 강함을 스스로 쓰기 위해 가장 "
        "낮은 카드를 대신 주고, 상대 두 명에게는 각각 두 번째로 낮은/세 번째로 낮은 카드를 줍니다. 마작은 항상 "
        "본인이 보유하고, 개는 기본적으로 상대에게 최저패 취급으로 가지만 본인이 그랜드 티츄를 불렀으면 파트너에게, "
        "파트너가 불렀으면 본인이 계속 보유합니다.",
        "- (소)티츄 콜 기능 자체가 이 환경에는 없어 아무도 티츄를 부르지 않습니다.",
        "- 마작(1)을 냈을 때의 '소원 카드' 지정도 이 환경은 항상 사용하지 않습니다.",
        "- 각 정책망이 실제로 판단하는 부분은 카드 교환이 끝난 뒤 각 트릭에서 무엇을 내고 언제 패스할지뿐입니다.",
        "- 드래곤으로 트릭을 이기면 원래는 누구에게 넘길지 선택해야 하지만, 이 환경은 자동으로 상대팀 중 아직 "
        "라운드에서 빠지지 않은 사람에게 넘깁니다.",
    ]
    if opponent_is_policy:
        lines.append(
            "- 매 차례마다 그 자리에 배정된 정책망 자신이 그 순간의 모든 합법 액션에 매긴 점수(logit/softmax "
            "확률)를 함께 적어둡니다 -- A팀 차례는 A 체크포인트, B팀 차례는 B 체크포인트 기준입니다."
        )
    else:
        lines.append(
            "- 매 차례마다 정책망(A 체크포인트)이 그 순간의 모든 합법 액션에 매긴 점수(logit/softmax 확률)를 함께 "
            "적어둡니다. 휴리스틱(B) 차례에도 참고용으로 항상 계산해서 보여주지만, 실제로 그 액션을 고르는 건 각 "
            "자리에 배정된 봇(A는 정책망 최댓값, B는 규칙 기반)입니다 -- '실제 선택'이 점수 1위가 아닐 수 있습니다."
        )
    lines.append("")
    return lines


def _seat_labels(team_a_seats: tuple[int, int]) -> dict[int, str]:
    return {s: f"{s}번({'A' if s in team_a_seats else 'B'})" for s in range(4)}


def _team_tags(team_a_seats: tuple[int, int]) -> dict[int, str]:
    team_a_index = 0 if 0 in team_a_seats else 1
    return {team_a_index: "A", 1 - team_a_index: "B"}


def _identifier(path: Path | None) -> str:
    """Short filename-safe id for a player: 'heuristic', or '<run dir>_<checkpoint stem>'."""
    if path is None:
        return "heuristic"
    return f"{path.parent.name}_{path.stem}"


def _main() -> None:
    parser = argparse.ArgumentParser(
        description="Play one Tichu round between two chosen players (checkpoints and/or the heuristic "
        "bot) and write a human-readable Korean narration of the game to a text file."
    )
    parser.add_argument("--checkpoint", default="latest", help="Team A: checkpoint path, or 'latest' for the newest in --checkpoint-dir.")
    parser.add_argument("--checkpoint-dir", type=Path, default=DEFAULT_CHECKPOINT_DIR)
    parser.add_argument(
        "--opponent",
        default="heuristic",
        help="Team B: 'heuristic', 'advanced_heuristic', a checkpoint path, or 'latest' for the newest in "
        "--opponent-checkpoint-dir.",
    )
    parser.add_argument(
        "--opponent-checkpoint-dir",
        type=Path,
        default=None,
        help="Directory to resolve --opponent 'latest' in (default: same as --checkpoint-dir).",
    )
    parser.add_argument("--team-a-seats", default="0,2", help="Comma-separated seats team A plays, e.g. '0,2'.")
    parser.add_argument("--stochastic", action="store_true", help="Sample actions instead of playing the argmax move.")
    parser.add_argument("--seed", type=int, default=None, help="Omit for a fresh random seed (still reported in the log/filename).")
    parser.add_argument("--output", type=Path, default=None, help="Output text file path (default: auto-named under game_logs/).")
    args = parser.parse_args()

    team_a_seats = tuple(int(s) for s in args.team_a_seats.split(","))
    if len(team_a_seats) != 2 or PARTNER[team_a_seats[0]] != team_a_seats[1]:
        raise ValueError("--team-a-seats must name one team, e.g. '0,2' or '1,3'")
    team_b_seats = tuple(s for s in range(4) if s not in team_a_seats)

    checkpoint_path = _resolve_checkpoint(args.checkpoint, args.checkpoint_dir)
    network_a = load_checkpoint(checkpoint_path)
    chooser_a = policy_chooser(network_a, deterministic=not args.stochastic)

    if args.opponent == "heuristic":
        chooser_b = heuristic_chooser()
        opponent_path = None
        scoring_networks = {seat: network_a for seat in range(4)}
        team_b_desc = "휴리스틱 봇(규칙 기반)"
        opponent_is_policy = False
    elif args.opponent == "advanced_heuristic":
        chooser_b = advanced_heuristic_chooser()
        opponent_path = None
        scoring_networks = {seat: network_a for seat in range(4)}
        team_b_desc = "고급 휴리스틱 봇(규칙 기반)"
        opponent_is_policy = False
    else:
        opponent_dir = args.opponent_checkpoint_dir if args.opponent_checkpoint_dir is not None else args.checkpoint_dir
        opponent_path = _resolve_checkpoint(args.opponent, opponent_dir)
        network_b = load_checkpoint(opponent_path)
        chooser_b = policy_chooser(network_b, deterministic=not args.stochastic)
        scoring_networks = {seat: (network_a if seat in team_a_seats else network_b) for seat in range(4)}
        team_b_desc = f"학습된 정책망(체크포인트: {opponent_path})"
        opponent_is_policy = True

    seat_choosers = {seat: (chooser_a if seat in team_a_seats else chooser_b) for seat in range(4)}
    seat_labels = _seat_labels(team_a_seats)
    team_tags = _team_tags(team_a_seats)

    seed = args.seed if args.seed is not None else random.SystemRandom().randrange(1_000_000)
    rng = random.Random(seed)
    env = TichuEnv(rng=rng)

    team_a_desc = f"학습된 정책망(체크포인트: {checkpoint_path})"
    lines = build_preamble(team_a_desc, team_b_desc, team_a_seats, team_b_seats, seed, opponent_is_policy)
    lines.extend(narrate_round(env, seat_choosers, seat_labels, scoring_networks, team_tags))

    output_path = args.output
    if output_path is None:
        a_id = _identifier(checkpoint_path)
        b_id = _identifier(opponent_path)
        output_path = DEFAULT_OUTPUT_DIR / f"{a_id}_vs_{b_id}_seed{seed}.txt"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"게임 로그를 저장했습니다: {output_path} (시드 {seed})")


if __name__ == "__main__":
    _main()
