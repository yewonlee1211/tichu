# E2E fixtures

`policy.onnx.enc` + `manifest.json` here are a tiny **untrained** `TichuPolicyValueNet`
export -- generated once via:

```bash
docker compose exec ai python -c "
import torch
from pathlib import Path
from agents.policy_network import TichuPolicyValueNet
from export.export_onnx import export_to_file, write_manifest

torch.manual_seed(0)
net = TichuPolicyValueNet()
ckpt = Path('/tmp/fixture_checkpoint.pt')
torch.save(net.state_dict(), ckpt)
export_to_file(ckpt, Path('deploy/client-models/policy.onnx.enc'))
write_manifest(Path('deploy/client-models/manifest.json'), 1)
"
```

(then moved out of the bind-mounted `deploy/client-models/` into this directory).

Unlike `packages/client/public/models/` (the real deployed model, gitignored because
it's a frequently-changing build artifact -- see that directory's own README), these
files are committed: `e2e/solo-ai.spec.ts` needs *some* structurally valid model to
mock `/models/*` responses with, and inference quality doesn't matter for an E2E test
that only checks "loads, and legal moves get made" -- not "plays well". Regenerate
only if the ONNX export contract itself changes (input/output names, opset version).
