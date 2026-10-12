export const pythonBudgetRuntimeSource = `
import sys


class ExecutionBudgetExceeded(RuntimeError):
    pass


_budget_limit = 1
_budget_remaining = 1
_project_directory = "/home/pyodide/project"


def configure(execution_budget):
    global _budget_limit, _budget_remaining
    _budget_limit = int(execution_budget)
    _budget_remaining = _budget_limit


def reset_budget():
    global _budget_remaining
    _budget_remaining = _budget_limit


def budget_used():
    return _budget_limit - _budget_remaining


def consume(amount=1):
    global _budget_remaining
    _budget_remaining -= int(amount)
    if _budget_remaining < 0:
        raise ExecutionBudgetExceeded(
            f"Python execution budget of {_budget_limit} trace events was exceeded"
        )


def _is_player_frame(frame):
    filename = frame.f_code.co_filename.replace("\\\\", "/")
    return filename == "main.py" or (
        filename.startswith(_project_directory + "/")
        and not filename.endswith("/microgame.py")
        and not filename.endswith("/_microgame_runtime.py")
    )


def _trace(frame, event, arg):
    if event in ("call", "line") and _is_player_frame(frame):
        consume()
    return _trace


def enable_budget():
    sys.settrace(_trace)


def disable_budget():
    sys.settrace(None)
`

export const microgameModuleSource = `
from dataclasses import asdict, dataclass, is_dataclass
import json

from pyodide.ffi import run_sync
import microgame_bridge as _bridge
from _microgame_runtime import (
    ExecutionBudgetExceeded,
    budget_used as _budget_used,
    consume as _consume,
    reset_budget as _reset_budget,
)


class ControlModeError(RuntimeError):
    pass


class InvalidWaitError(ValueError):
    pass


@dataclass(frozen=True)
class Vec2:
    x: float
    y: float


@dataclass(frozen=True)
class EnemyView:
    id: int
    kind: str
    position: Vec2
    hp: int
    distance: float


@dataclass(frozen=True)
class Observation:
    tick: int
    hp: int
    max_hp: int
    position: Vec2
    enemies: tuple[EnemyView, ...]
    nearest_enemy: EnemyView | None


@dataclass(frozen=True)
class Action:
    move_x: float = 0.0
    move_y: float = 0.0
    target_enemy_id: int | None = None

    @staticmethod
    def flee(me, danger, attack_target_id=None):
        dx = float(me.x) - float(danger.x)
        dy = float(me.y) - float(danger.y)
        length = (dx * dx + dy * dy) ** 0.5
        if length == 0:
            dx, dy = 1.0, 0.0
        else:
            dx, dy = dx / length, dy / length
        return Action(dx, dy, attack_target_id)


_observation = Observation(0, 1, 1, Vec2(0.0, 0.0), (), None)
_controller = None


def _to_observation(value):
    enemies = tuple(
        EnemyView(
            id=enemy["id"],
            kind=enemy["kind"],
            position=Vec2(**enemy["position"]),
            hp=enemy["hp"],
            distance=enemy["distance"],
        )
        for enemy in value["enemies"]
    )
    nearest_id = value["nearest_enemy_id"]
    nearest = next((enemy for enemy in enemies if enemy.id == nearest_id), None)
    return Observation(
        tick=value["tick"],
        hp=value["hp"],
        max_hp=value["max_hp"],
        position=Vec2(**value["position"]),
        enemies=enemies,
        nearest_enemy=nearest,
    )


def _set_context(context_json):
    global _observation
    context = json.loads(str(context_json))
    _observation = _to_observation(context["observation"])


def _action_value(action):
    if is_dataclass(action):
        return asdict(action)
    return action


def _action_json(action):
    try:
        return json.dumps(
            _action_value(action), separators=(",", ":"), allow_nan=False
        )
    except (TypeError, ValueError):
        return "null"


def _ensure_action_allowed():
    if not _bridge.action_allowed():
        raise ControlModeError(
            "Action functions cannot be used while a Controller owns the slime"
        )


def _suspend(kind, action_json, ticks):
    used = _budget_used()
    context_json = run_sync(_bridge.suspend(kind, action_json, ticks, used))
    _set_context(context_json)
    _reset_budget()


def act(action):
    _ensure_action_allowed()
    payload = _action_json(action)
    _suspend("action", payload, 6)


def wait_ticks(n):
    if isinstance(n, bool) or not isinstance(n, int) or n <= 0:
        raise InvalidWaitError("wait_ticks(n) requires a positive integer")
    if not _bridge.wait_allowed():
        raise ControlModeError("wait_ticks() cannot be used inside decide()")
    _suspend("wait", None, n)


def get_state():
    _consume()
    return _observation


def self_position():
    state = get_state()
    return getattr(state, "position", Vec2(0.0, 0.0))


def nearest_enemy():
    return get_state().nearest_enemy


def attack_nearest():
    enemy = nearest_enemy()
    target_id = None if enemy is None else enemy.id
    act(Action(target_enemy_id=target_id))
    return target_id


def set_ai(controller):
    global _controller
    if _controller is not None:
        raise ControlModeError("A Controller is already registered")
    if not hasattr(controller, "decide") and not callable(controller):
        raise TypeError("set_ai(controller) requires decide(state) or a callable")
    _controller = controller
    _bridge.register_controller()


def _register_legacy_controller(controller):
    global _controller
    if _controller is None:
        _controller = controller
        _bridge.register_controller()


def _controller_callable():
    candidate = _controller
    if hasattr(candidate, "decide"):
        candidate = candidate.decide
    return candidate


def _current_observation():
    return _observation
`

export const pythonBootstrapSource = `
import json
import _microgame_runtime
import microgame

microgame._set_context(_microgame_initial_context_json)
_microgame_runtime.reset_budget()
_microgame_runtime.enable_budget()
try:
    _microgame_namespace = {"__name__": "__main__", "__file__": "main.py"}
    exec(compile(_microgame_source, "main.py", "exec"), _microgame_namespace)
finally:
    _microgame_runtime.disable_budget()

_microgame_candidate = _microgame_namespace.get(
    "controller", _microgame_namespace.get("decide")
)
if _microgame_candidate is not None:
    microgame._register_legacy_controller(_microgame_candidate)
`

export const pythonControllerBoundarySource = `
import json
import _microgame_runtime
import microgame

microgame._set_context(_microgame_boundary_context_json)
_microgame_runtime.reset_budget()
_microgame_runtime.enable_budget()
try:
    _microgame_controller = microgame._controller_callable()
    if not callable(_microgame_controller):
        raise TypeError("Controller must define decide(state) or be callable")
    _microgame_controller_result = _microgame_controller(
        microgame._current_observation()
    )
    _microgame_controller_json = json.dumps(
        {
            "actionJson": microgame._action_json(_microgame_controller_result),
            "budgetUsed": _microgame_runtime.budget_used(),
        },
        separators=(",", ":"),
    )
finally:
    _microgame_runtime.disable_budget()

_microgame_controller_json
`
