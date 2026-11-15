import copy
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
schema = json.loads((ROOT / "aimp-v3.2-handshake-schemas.json").read_text())


def check(value, spec):
    if "$ref" in spec:
        return check(value, schema["$defs"][spec["$ref"].split("/")[-1]])
    if "anyOf" in spec:
        for choice in spec["anyOf"]:
            try:
                check(value, choice)
                return
            except AssertionError:
                continue
        raise AssertionError("no alternative matched")
    types = {"object": isinstance(value, dict), "array": isinstance(value, list), "string": isinstance(value, str), "integer": type(value) is int, "boolean": type(value) is bool, "null": value is None}
    if "type" in spec:
        assert types[spec["type"]]
    if "const" in spec:
        assert value == spec["const"]
    if "enum" in spec:
        assert value in spec["enum"]
    if isinstance(value, dict):
        assert set(spec.get("required", [])) <= value.keys()
        props = spec.get("properties", {})
        extra = spec.get("additionalProperties", True)
        if extra is False:
            assert value.keys() <= props.keys()
        for key, item in value.items():
            if key in props:
                check(item, props[key])
            elif isinstance(extra, dict):
                check(item, extra)
    if isinstance(value, list):
        assert len(value) >= spec.get("minItems", 0)
        if spec.get("uniqueItems"):
            assert len({json.dumps(v, sort_keys=True) for v in value}) == len(value)
        for item in value:
            check(item, spec.get("items", {}))
    if isinstance(value, str):
        assert len(value) >= spec.get("minLength", 0)
        if "pattern" in spec:
            assert re.search(spec["pattern"], value)
    if type(value) is int and "minimum" in spec:
        assert value >= spec["minimum"]
    for condition in spec.get("allOf", []):
        try:
            check(value, condition["if"])
        except AssertionError:
            continue
        check(value, condition["then"])


def example_value(spec):
    if "$ref" in spec:
        return example_value(schema["$defs"][spec["$ref"].split("/")[-1]])
    if "const" in spec:
        return spec["const"]
    if "enum" in spec:
        return spec["enum"][0]
    if "anyOf" in spec:
        return example_value(spec["anyOf"][0])
    kind = spec.get("type")
    if kind == "object":
        return {key: example_value(spec["properties"][key]) for key in spec.get("required", [])}
    if kind == "array":
        return [example_value(spec["items"])] * spec.get("minItems", 0)
    if kind == "integer":
        return max(1, spec.get("minimum", 0))
    if kind == "boolean":
        return True
    if kind == "string":
        return "0" * 64 if spec.get("pattern") == "^[0-9a-f]{64}$" else "test"
    if kind == "null":
        return None
    raise ValueError(spec)


vectors = json.loads((ROOT / "aimp-v3.2-vectors.json").read_text())
for vector in vectors["vectors"]:
    if vector["type"] == "contract":
        check(vector["input"], schema["$defs"]["contract"])
for name, spec in schema["$defs"].items():
    if not name.startswith(("session.", "sys.session")):
        continue
    value = example_value(spec)
    check(value, spec)
    extra = dict(value, hidden_scope="must reject")
    try:
        check(extra, spec)
    except AssertionError:
        pass
    else:
        raise AssertionError("unlisted field accepted")
    missing = copy.deepcopy(value)
    del missing["kind"]
    try:
        check(missing, spec)
    except AssertionError:
        pass
    else:
        raise AssertionError("missing kind accepted")
    print(name, "closed field, mandatory kind, positive sample: passed")
print("Scope: small validator for keywords used by these schemas; not a general JSON Schema implementation or authority/identity validation")
