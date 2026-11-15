import copy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Draft:
    def __init__(self, parties, expires=100):
        self.parties = tuple(parties)
        self.expires = expires
        self.revision = 1
        self.state = "drafting"
        self.accepts = set()
        self.confirmed = False
        self.invitation_valid = True
        self.owner_epoch = 1
        self.confirmed_owner_epoch = None
        self.old_contract_hash = None
        self.receipts = {}

    def submit(self, event_id, kind, revision, *, who=None, now=0, owner_epoch=None):
        intent = json.dumps([kind, revision, who, now, owner_epoch])
        if event_id in self.receipts:
            old_intent, result = self.receipts[event_id]
            return result if old_intent == intent else "conflict"
        before = copy.deepcopy(self.__dict__)
        if self.state in ("expired", "declined", "active") or revision != self.revision:
            result = "rejected"
        elif not self.invitation_valid:
            result = "rejected"
        elif now >= self.expires:
            result = "rejected"
        elif kind == "counter":
            self.revision += 1
            self.accepts.clear()
            self.confirmed = False
            self.confirmed_owner_epoch = None
            self.state = "drafting"
            result = "sequenced"
        elif kind == "accept" and who in self.parties:
            self.accepts.add(who)
            if self.accepts == set(self.parties):
                self.state = "signed"
            result = "sequenced"
        elif kind == "confirm" and who == "owner" and owner_epoch == self.owner_epoch:
            self.confirmed = True
            self.confirmed_owner_epoch = owner_epoch
            result = "sequenced"
        elif kind == "reject" and who in self.parties:
            self.state = "declined"
            result = "sequenced"
        else:
            result = "rejected"
        if result == "rejected":
            assert before == self.__dict__, "Rejected input modified model state"
        self.receipts[event_id] = intent, result
        return result

    def activate(self, conversation, *, now, current_head=None):
        if self.state != "signed" or not self.confirmed or not self.invitation_valid:
            return "rejected"
        if self.confirmed_owner_epoch != self.owner_epoch or now >= self.expires:
            return "rejected"
        if self.old_contract_hash != current_head:
            return "rejected"
        if self.old_contract_hash is None and conversation["head"] is not None:
            return "rejected"
        self.state = "active"
        conversation["head"] = hashlib.sha256(str((self.parties, self.revision)).encode()).hexdigest()
        return "sequenced"


def signed_draft():
    d = Draft(["owner", "agent"])
    assert d.submit("a", "accept", 1, who="owner") == "sequenced"
    assert d.submit("b", "accept", 1, who="agent") == "sequenced"
    assert d.submit("c", "confirm", 1, who="owner", owner_epoch=1) == "sequenced"
    return d


def test():
    d = signed_draft()
    assert d.activate({"head": None}, now=1) == "sequenced"
    d = signed_draft()
    assert d.submit("counter1", "counter", 1) == "sequenced"
    assert d.submit("counter2", "counter", 1) == "rejected"
    assert not d.accepts and not d.confirmed
    assert d.submit("old-accept", "accept", 1, who="agent") == "rejected"
    assert d.submit("old-confirm", "confirm", 1, who="owner", owner_epoch=1) == "rejected"
    d = signed_draft()
    assert d.activate({"head": None}, now=100) == "rejected"
    d = signed_draft()
    d.invitation_valid = False
    assert d.activate({"head": None}, now=1) == "rejected"
    assert d.submit("counter-new", "counter", 1) == "rejected"
    assert d.submit("a", "accept", 1, who="owner") == "sequenced"
    d = signed_draft()
    d.owner_epoch = 2
    assert d.activate({"head": None}, now=1) == "rejected"
    first, second = signed_draft(), signed_draft()
    conversation = {"head": None}
    assert first.activate(conversation, now=1) == "sequenced"
    assert second.activate(conversation, now=1) == "rejected"
    first, second = signed_draft(), signed_draft()
    conversation = {"head": "old"}
    first.old_contract_hash = second.old_contract_hash = "old"
    assert first.activate(conversation, now=1, current_head="old") == "sequenced"
    assert second.activate(conversation, now=1, current_head=conversation["head"]) == "rejected"
    d = Draft(["owner", "agent"])
    assert d.submit("bot-confirm", "confirm", 1, who="agent", owner_epoch=1) == "rejected"
    assert d.submit("reject", "reject", 1, who="owner") == "sequenced"
    assert d.submit("after-reject", "accept", 1, who="owner") == "rejected"
    d = Draft(["owner", "agent"])
    assert d.submit("same-id", "accept", 1, who="owner") == "sequenced"
    assert d.submit("same-id", "accept", 1, who="agent") == "conflict"
    print("Model tests passed: happy path, concurrent revision/initialization/change-head interleavings, old confirmation, deadline, revocation, owner change, actor restrictions, terminal state, id conflict")
    print("Scope: sequential reference model only; does not validate real identities, network consistency, distributed transactions or a production implementation")


if __name__ == "__main__":
    test()
