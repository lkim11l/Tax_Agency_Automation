# Contract review

Phase 7 reviews one immutable `contract_version`, never a mutable application
view. An active specialist or administrator must download/open the private DOCX
from the application page before recording a decision.

Before a decision, the server verifies:

- status is `awaiting_review`;
- private Storage object exists and has a DOCX ZIP signature;
- downloaded SHA-256 equals the version checksum;
- template version, completeness run, and source fingerprint remain present;
- no newer active version exists;
- the contract has not already been delivered.

Decisions are `approved`, `rejected`, or `returned_for_regeneration`. Reject and
return require a comment. The review row records reviewer, time, checksum, and
source fingerprint and cannot be edited or deleted. A new generated version has
`awaiting_review` and needs a new review; historical approval never transfers.

Approval moves the application to `contract_ready`. Reject/return moves it to
`contract_revision_required`. Existing Phase 6 administrator force regeneration
is the only way to create a replacement version. No AI participates in review.
