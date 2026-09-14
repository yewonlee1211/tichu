import random

from tichu_env.env import TichuEnv
from tichu_env.state import Phase


def _play_full_round(env: TichuEnv, rng: random.Random) -> None:
    result = env.reset()
    steps = 0
    max_steps = 500  # generous upper bound; a real round finishes in well under this
    while not result.done:
        combo, _ = rng.choice(result.legal_actions)
        result = env.step(combo)
        steps += 1
        assert steps < max_steps, "round did not terminate within a sane number of steps"


def test_random_agent_completes_many_rounds_without_crashing():
    rng = random.Random(0)
    env = TichuEnv(rng=rng)

    for _ in range(200):
        _play_full_round(env, rng)
        assert env.state.phase is Phase.ROUND_OVER


def test_reset_lands_in_large_tichu_phase_with_8_card_hands():
    env = TichuEnv(rng=random.Random(1))

    result = env.reset()

    assert env.state.phase is Phase.LARGE_TICHU
    assert all(len(hand) == 8 for hand in env.state.hands)
    assert result.done is False


def test_legal_actions_during_large_tichu_offers_only_call_and_decline_for_the_current_seat():
    env = TichuEnv(rng=random.Random(1))

    result = env.reset()

    assert {action for action, _ in result.legal_actions} == {True, False}


def test_declining_large_tichu_four_times_reaches_playing_phase_with_14_card_hands():
    env = TichuEnv(rng=random.Random(1))
    result = env.reset()

    for _ in range(4):
        assert result.state.phase is Phase.LARGE_TICHU
        decline = next(action for action, _ in result.legal_actions if action is False)
        result = env.step(decline)

    assert result.state.phase is Phase.PLAYING
    assert all(len(hand) == 14 for hand in result.state.hands)
    assert result.done is False


def test_step_rejects_a_non_bool_action_during_large_tichu_phase():
    env = TichuEnv(rng=random.Random(1))
    env.reset()

    try:
        env.step(None)
    except ValueError:
        pass
    else:
        raise AssertionError("expected step() to reject a non-bool action during Phase.LARGE_TICHU")


def test_step_raises_on_action_outside_legal_set():
    env = TichuEnv(rng=random.Random(2))
    env.reset()

    bogus_hand = env.state.hands[(env.current_player + 1) % 4]
    from tichu_env.combinations import identify_combo

    foreign_combo = identify_combo([bogus_hand[0]]) if bogus_hand else None

    if foreign_combo is not None:
        try:
            env.step(foreign_combo)
        except ValueError:
            pass
        else:
            raise AssertionError("expected step() to reject a card the current player does not hold")


def _decline_large_tichu_for_everyone(env: TichuEnv):
    result = env.reset()
    for _ in range(4):
        decline = next(action for action, _ in result.legal_actions if action is False)
        result = env.step(decline)
    return result


def test_legal_actions_offer_tichu_call_and_decline_at_a_players_first_turn():
    env = TichuEnv(rng=random.Random(1))
    result = _decline_large_tichu_for_everyone(env)

    assert result.state.phase is Phase.PLAYING
    assert {action for action, _ in result.legal_actions} == {True, False}


def test_declining_tichu_then_proceeds_to_ordinary_trick_play_actions():
    env = TichuEnv(rng=random.Random(1))
    result = _decline_large_tichu_for_everyone(env)
    decliner = result.state.current_player

    result = env.step(False)

    assert result.state.current_player == decliner, "the decision doesn't consume their real turn"
    assert result.state.tichu_decided[decliner] is True
    assert result.state.tichu_calls[decliner] is False
    assert all(not isinstance(action, bool) for action, _ in result.legal_actions)


def test_calling_tichu_records_the_call_and_then_proceeds_to_trick_play():
    env = TichuEnv(rng=random.Random(1))
    result = _decline_large_tichu_for_everyone(env)
    caller = result.state.current_player

    result = env.step(True)

    assert env.state.tichu_calls[caller] is True
    assert all(not isinstance(action, bool) for action, _ in result.legal_actions)


def test_tichu_decision_is_never_offered_again_once_decided():
    env = TichuEnv(rng=random.Random(1))
    result = _decline_large_tichu_for_everyone(env)
    first_player = result.state.current_player
    result = env.step(False)

    # Play the round out; whenever it's first_player's turn again, they must
    # never see the bool tichu decision a second time.
    rng = random.Random(99)
    while not result.done:
        if result.player == first_player:
            assert all(not isinstance(action, bool) for action, _ in result.legal_actions)
        combo, _ = rng.choice(result.legal_actions)
        result = env.step(combo)


def test_step_rejects_a_non_bool_action_during_the_tichu_decision():
    env = TichuEnv(rng=random.Random(1))
    _decline_large_tichu_for_everyone(env)

    try:
        env.step(None)
    except ValueError:
        pass
    else:
        raise AssertionError("expected step() to reject a non-bool action during the tichu call decision")


def test_step_result_exposes_the_current_game_state():
    env = TichuEnv(rng=random.Random(4))

    reset_result = env.reset()
    assert reset_result.state == env.state

    combo, _ = reset_result.legal_actions[0]
    step_result = env.step(combo)
    assert step_result.state == env.state


def test_finished_round_reports_team_scores_in_info():
    rng = random.Random(3)
    env = TichuEnv(rng=rng)
    result = env.reset()

    while not result.done:
        combo, _ = rng.choice(result.legal_actions)
        result = env.step(combo)

    assert "team_scores" in result.info
    team0, team1 = result.info["team_scores"]
    assert isinstance(team0, int)
    assert isinstance(team1, int)
