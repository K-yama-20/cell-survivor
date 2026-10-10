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
