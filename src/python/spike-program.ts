import type { PythonFiles } from './protocol'

export const PYTHON_SPIKE_CALL_COUNT = 1_001

export const pythonSpikeFiles: PythonFiles = {
  'utils.py': `import math

def recursive_count(value):
    if value <= 0:
        return 0
    return 1 + recursive_count(value - 1)

def unit_vector(angle):
    return (round(math.cos(angle), 6), round(math.sin(angle), 6))
`,
  'main.py': `import math
from utils import recursive_count, unit_vector

class Controller:
    def __init__(self):
        self.calls = 0

    def decide(self, state):
        self.calls += recursive_count(1)
        if self.calls != state["expected_call"]:
            raise AssertionError("controller state was not preserved")
        if state.get("fail"):
            raise RuntimeError("deliberate spike failure")
        angle = 0 if self.calls % 2 else math.pi
        move_x, move_y = unit_vector(angle)
        return {
            "move_x": move_x,
            "move_y": move_y,
            "target_enemy_id": state.get("target_enemy_id"),
        }

controller = Controller()
`,
}

export const pythonContinuationSpikeFiles: PythonFiles = {
  'main.py': `import os
import js
from pyodide.ffi import run_sync
from microgame import Action, act, get_state, wait_ticks

if hasattr(js, "require") or hasattr(js, "process"):
    raise RuntimeError("Node.js globals must not be exposed to player Python")
if os.path.exists("C:/Windows"):
    raise RuntimeError("Host filesystem must not be mounted into Pyodide")
try:
    run_sync(js.fetch("https://example.com"))
except Exception:
    pass
else:
    raise RuntimeError("External network access must be blocked by CSP")

def nested_loop():
    local_target = 40
    frozen_tick = get_state().tick
    assert get_state().tick == frozen_tick
    while True:
        act(Action(target_enemy_id=local_target))
        local_target += 1
        wait_ticks(1)

nested_loop()
`,
}
