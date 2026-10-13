---
name: component-review
description: Contributor guidance for component review.
---

# Component review

Read README, CONTRIBUTING, relevant ADRs and the complete diff. Trace app calls through client copies, validators, provider transport, mirror writers and example authorization.

Check V8 portability, env secrets, modes, fixed errors, indexed bounds, generated bindings, exports and retention. For each defect, state its file, reachable trigger, consequence and fix. Separate confirmed defects from concerns and simulator proof from local runtime or provider observations.
