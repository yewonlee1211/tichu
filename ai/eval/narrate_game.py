from __future__ import annotations

import argparse
import random
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch

from tichu_env.cards import Card, Rank, Suit
from tichu_env.combinations import BOMB_TYPES, Combo, ComboType
from tichu_env.env import StepResult, TichuEnv
from tichu_env.state import PARTNER, GameState

from agents.policy_network import TichuPolicyValueNet
from eval.arena import SeatChooser, _resolve_checkpoint, heuristic_chooser, load_checkpoint, policy_chooser

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


def _score_actions(network: TichuPolicyValueNet, result: StepResult) -> list[tuple[Combo | None, float, float]]:
    """Scores every legal action for `result`'s current player under `network`,
    regardless of which chooser (policy or heuristic) actually acts this turn --
    this always reflects "how the trained network would rate these options."
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


def _action_label(combo: Combo | None) -> str:
    if combo is None:
        return "패스"
    return f"{cards_str(combo.cards)} ({COMBO_TYPE_NAMES[combo.combo_type]})"


def narrate_round(
    env: TichuEnv,
    seat_choosers: dict[int, SeatChooser],
    seat_labels: dict[int, str],
    scoring_network: TichuPolicyValueNet,
) -> list[str]:
    """Plays one round to completion and returns a Korean natural-language
    narration of every action, trick resolution, and the final round result."""
    lines: list[str] = []
    result = env.reset()

    lines.append("## 카드 교환 후 시작 손패")
    for seat in range(4):
        lines.append(f"- {seat_labels[seat]}: {cards_str(env.state.hands[seat])}")
    lines.append("")
    lines.append("## 진행")

    turn_no = 0
    while not result.done:
        state_before = env.state
        player = result.player
        is_leading = state_before.current_best is None

        scored_actions = _score_actions(scoring_network, result)
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

    lines.append("")
    lines.extend(_describe_round_end(env.state, result.info["team_scores"], seat_labels))
    return lines


def _describe_action(combo: Combo | None, is_leading: bool) -> str:
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
    state_before: GameState, state_after: GameState, combo: Combo | None, seat_labels: dict[int, str]
) -> list[str]:
    notes: list[str] = []

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


def _describe_round_end(state: GameState, team_scores: tuple[int, int], seat_labels: dict[int, str]) -> list[str]:
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

    lines.append(f"- 팀 점수(이번 라운드만): 0+2번 팀 {team_scores[0]:+d}점, 1+3번 팀 {team_scores[1]:+d}점")
    lines.append("- 티츄/그랜드 티츄 보너스: 없음 (이 환경은 티츄 콜을 아직 지원하지 않아 항상 콜하지 않은 것으로 처리됩니다)")
    return lines


def build_preamble(checkpoint_path: Path, opponent: str, policy_seats: tuple[int, int], seed: int | None) -> list[str]:
    other_seats = tuple(s for s in range(4) if s not in policy_seats)
    seat_labels = _seat_labels(policy_seats)
    return [
        "# Tichu AI 테스트 게임 로그",
        "",
        f"- 체크포인트: {checkpoint_path}",
        f"- 대결 구도: {seat_labels[policy_seats[0]]}, {seat_labels[policy_seats[1]]} = 학습된 정책망(AI) / "
        f"{seat_labels[other_seats[0]]}, {seat_labels[other_seats[1]]} = {opponent}",
        "- 팀: 0번+2번 팀 vs 1번+3번 팀",
        f"- 시드: {seed if seed is not None else '(무작위)'}",
        "",
        "## 참고 (이 환경의 알려진 한계)",
        "- 그랜드 티츄 콜과 카드 교환은 아직 학습 대상이 아닙니다: 모든 플레이어가 그랜드 티츄를 자동으로 포기하고, "
        "각자 자신의 가장 낮은 카드 3장을 상대에게 기계적으로 나눠주는 고정 규칙을 씁니다.",
        "- (소)티츄 콜 기능 자체가 이 환경에는 없어 아무도 티츄를 부르지 않습니다.",
        "- 마작(1)을 냈을 때의 '소원 카드' 지정도 이 환경은 항상 사용하지 않습니다.",
        "- AI가 실제로 판단하는 부분은 카드 교환이 끝난 뒤 각 트릭에서 무엇을 내고 언제 패스할지뿐입니다.",
        "- 드래곤으로 트릭을 이기면 원래는 누구에게 넘길지 선택해야 하지만, 이 환경은 자동으로 상대팀 중 아직 "
        "라운드에서 빠지지 않은 사람에게 넘깁니다.",
        "- 매 차례마다 정책망(위 체크포인트)이 그 순간의 모든 합법 액션에 매긴 점수(logit/softmax 확률)를 함께 "
        "적어둡니다. 휴리스틱 차례에도 참고용으로 항상 계산해서 보여주지만, 실제로 그 액션을 고르는 건 각 자리에 "
        "배정된 봇(AI는 정책망 최댓값, 휴리스틱은 규칙 기반)입니다 -- '실제 선택'이 점수 1위가 아닐 수 있습니다.",
        "",
    ]


def _seat_labels(policy_seats: tuple[int, int]) -> dict[int, str]:
    return {s: f"{s}번({'AI' if s in policy_seats else '휴리스틱'})" for s in range(4)}


def _main() -> None:
    parser = argparse.ArgumentParser(
        description="Play one Tichu round with a trained checkpoint vs. a baseline and write a "
        "human-readable Korean narration of the game to a text file."
    )
    parser.add_argument("--checkpoint", default="latest", help="Checkpoint path, or 'latest' for the newest in --checkpoint-dir.")
    parser.add_argument("--checkpoint-dir", type=Path, default=DEFAULT_CHECKPOINT_DIR)
    parser.add_argument("--policy-seats", default="0,2", help="Comma-separated seats the checkpoint plays, e.g. '0,2'.")
    parser.add_argument("--stochastic", action="store_true", help="Sample actions instead of playing the argmax move.")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--output", type=Path, default=None, help="Output text file path (default: auto-named under game_logs/).")
    args = parser.parse_args()

    policy_seats = tuple(int(s) for s in args.policy_seats.split(","))
    if len(policy_seats) != 2 or PARTNER[policy_seats[0]] != policy_seats[1]:
        raise ValueError("--policy-seats must name one team, e.g. '0,2' or '1,3'")

    checkpoint_path = _resolve_checkpoint(args.checkpoint, args.checkpoint_dir)
    network = load_checkpoint(checkpoint_path)
    chooser = policy_chooser(network, deterministic=not args.stochastic)
    opponent_chooser = heuristic_chooser()
    seat_choosers = {seat: (chooser if seat in policy_seats else opponent_chooser) for seat in range(4)}
    seat_labels = _seat_labels(policy_seats)

    rng = random.Random(args.seed) if args.seed is not None else random.Random()
    env = TichuEnv(rng=rng)

    lines = build_preamble(checkpoint_path, "휴리스틱 봇(규칙 기반)", policy_seats, args.seed)
    lines.extend(narrate_round(env, seat_choosers, seat_labels, scoring_network=network))

    output_path = args.output
    if output_path is None:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        output_path = DEFAULT_OUTPUT_DIR / f"game_{timestamp}.txt"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"게임 로그를 저장했습니다: {output_path}")


if __name__ == "__main__":
    _main()
