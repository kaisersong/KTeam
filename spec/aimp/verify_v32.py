import argparse
import copy
import hashlib
import json
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

ROOT = Path(__file__).resolve().parent
SEED = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")


def canonical(value):
    if isinstance(value, dict):
        return "{" + ",".join(canonical(k) + ":" + canonical(value[k]) for k in sorted(value, key=lambda k: k.encode("utf-16be"))) + "}"
    if isinstance(value, list):
        return "[" + ",".join(canonical(v) for v in value) + "]"
    if isinstance(value, str):
        value.encode("utf-8")
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if value is None or isinstance(value, bool):
        return json.dumps(value)
    if type(value) is int and abs(value) <= 9007199254740991:
        return str(value)
    raise ValueError("Vector tool implements only the JCS safe-integer subset; not a full JCS implementation")


def signed_bytes(kind, value):
    return ("AIMP/1/" + kind + "\0").encode() + canonical(value).encode()


def digest(kind, value):
    return hashlib.sha256(signed_bytes(kind, value)).hexdigest()


def at_path(obj, path):
    target = obj
    parts = path.split(".")
    for part in parts[:-1]:
        target = target[part]
    return target, parts[-1]


def expand(template, policy, overrides):
    result = copy.deepcopy(template["contract"])
    for path, source in template["inherit"].items():
        target, key = at_path(result, path)
        policy_target, policy_key = at_path(policy["values"], source)
        target[key] = copy.deepcopy(policy_target[policy_key])
    for field, value in overrides.items():
        rule = template["bounds"][field]
        if type(value) is not int or not rule["min"] <= value <= rule["max"]:
            raise ValueError("override outside bounds")
        target, key = at_path(result, rule["path"])
        target[key] = value
    if result["security"]["freshness_seconds"] > 300:
        raise ValueError("unsafe freshness")
    if result["sequencer"]["id"] == result["receipts"]["executor_id"]:
        raise ValueError("self-attesting receipt sequencer")
    result["template_binding"] = {"id": template["id"], "hash": digest("template", template)}
    result["policy_binding"] = {"version": policy["version"], "hash": digest("policy", policy)}
    return result


def build_vectors():
    template = json.loads((ROOT / "template-core-l2.json").read_text())
    sandbox_path = ROOT / "template-sandbox.json"
    if sandbox_path.exists():
        sandbox = json.loads(sandbox_path.read_text())
    else:
        sandbox = copy.deepcopy(template)
        sandbox["id"] = "aimp.tpl.sandbox-settlement@1"
        sandbox["contract"]["profile"] = "AIMP/v3.2/Core-L2+Sandbox-Settlement"
        sandbox["contract"]["supported_events"].append("sys.settled")
        sandbox["contract"]["simulation"] = {"ledger": "virtual", "real_money": False, "creates_economic_reputation": False}
        sandbox_path.write_text(json.dumps(sandbox, ensure_ascii=False, indent=2) + "\n")
    policy = json.loads((ROOT / "example-policy.json").read_text())
    contract = expand(template, policy, {"review_seconds": 86400})
    sandbox_contract = expand(sandbox, policy, {})
    key = Ed25519PrivateKey.from_private_bytes(SEED)
    public = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw).hex()
    propose = {
        "aimp": "1.0", "id": "msg_propose_vector", "thread_id": "thread_bootstrap",
        "control_ref": "session_vector", "target_event": None,
        "from": "human://test.example/owner", "to": ["agent://test.example/report"],
        "act": "session.propose", "source_level": "principal", "key_id": "rfc8032-public-test-key",
        "audience": ["sequencer://test.example/primary"], "exp": "2026-11-14T00:05:00Z",
        "payload_hash": hashlib.sha256(canonical({"kind": "session.propose@1", "must_understand": True, "revision": 1, "contract": contract, "draft_hash": digest("contract", contract), "old_contract_hash": None}).encode()).hexdigest(),
        "body_hash": hashlib.sha256("请确认完整契约".encode()).hexdigest(),
    }
    accept = {
        "aimp": "1.0", "id": "msg_accept_vector", "thread_id": "thread_bootstrap",
        "control_ref": "session_vector", "target_event": {"id": "msg_propose_vector", "hash": digest("intent", propose)},
        "from": "agent://test.example/report", "to": ["human://test.example/owner"],
        "act": "session.accept", "source_level": "peer", "key_id": "rfc8032-public-test-key",
        "audience": ["sequencer://test.example/primary"], "exp": "2026-11-14T00:05:00Z",
        "payload_hash": hashlib.sha256(canonical({"kind": "session.accept@1", "must_understand": True, "revision": 1, "draft_hash": digest("contract", contract), "old_contract_hash": None}).encode()).hexdigest(),
        "body_hash": hashlib.sha256("接受本次展开契约".encode()).hexdigest(),
    }
    vectors = []
    for kind, obj in (("template", template), ("contract", contract), ("intent", accept), ("template", sandbox), ("contract", sandbox_contract)):
        data = signed_bytes(kind, obj)
        vectors.append({"type": kind, "input": obj, "canonical_hex": canonical(obj).encode().hex(), "domain_hex": ("AIMP/1/" + kind + "\0").encode().hex(), "sha256": hashlib.sha256(data).hexdigest(), "public_key_hex": public, "signature_hex": key.sign(data).hex(), "expected": "valid"})
    return {"notice": "RFC 8032 public test key; never use in production. Safe-integer JCS subset only; projection fixtures are not valid production admission credentials.", "propose_projection": propose, "vectors": vectors}


def verify(data):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    for vector in data["vectors"]:
        raw = signed_bytes(vector["type"], vector["input"])
        assert vector["canonical_hex"] == canonical(vector["input"]).encode().hex()
        assert hashlib.sha256(raw).hexdigest() == vector["sha256"]
        key = Ed25519PublicKey.from_public_bytes(bytes.fromhex(vector["public_key_hex"]))
        key.verify(bytes.fromhex(vector["signature_hex"]), raw)
        for bad in (raw + b"x", signed_bytes("wrong-object", vector["input"])):
            try:
                key.verify(bytes.fromhex(vector["signature_hex"]), bad)
            except InvalidSignature:
                pass
            else:
                raise AssertionError("invalid signature accepted")
        print(vector["type"], "bytes/hash/signature and negative cases passed")
    template = json.loads((ROOT / "template-core-l2.json").read_text())
    policy = json.loads((ROOT / "example-policy.json").read_text())
    assert expand(template, policy, {"review_seconds": 86400}) == data["vectors"][1]["input"]
    try:
        expand(template, policy, {"review_seconds": 1})
    except ValueError:
        pass
    else:
        raise AssertionError("invalid override accepted")
    modified = copy.deepcopy(policy)
    modified["version"] += 1
    modified["values"]["sequencer"]["id"] = "sequencer://test.example/changed"
    assert digest("contract", expand(template, modified, {})) != digest("contract", expand(template, policy, {}))
    print("Deterministic offline expansion, invalid override and changed policy hash: passed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--generate", action="store_true")
    options = parser.parse_args()
    path = ROOT / "aimp-v3.2-vectors.json"
    if options.generate:
        data = build_vectors()
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    else:
        data = json.loads(path.read_text())
    verify(data)
