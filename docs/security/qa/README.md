# Contact privacy synthetic regression

`archived-contact-preinstall-fixture.sql` is disposable synthetic data only. Load it after the inherited release actor/student fixtures and the PR96 pair, before the six privacy installers and runtime ACL activation. It uses the inherited synthetic actor `99720000-0000-4000-8000-000000000001` and student `78000000-0000-4000-8000-000000000201`.

Run `archived-contact-reopen.pgtap.sql` only on that isolated database after installing the exact final transaction. It calls the actual public mutation RPC as `service_role`, retains all business guards, and rolls back every test effect. It covers legacy archived nonterminal/terminal cases, a still-open case with an archived sibling, an intake with no historical subjects, fresh/omitted contact on save, failure after subject restoration, request replay/reuse, stale revisions, explicit cancellation/reopening, and repeated archive/unarchive. Saving a contact with no reopened subject fails atomically with SQLSTATE 23514, matching the existing closed-case contract.

The release evidence also passes actual `get_registration_case_contact_v1` JSON through the application normalizer. Inferred legacy closure uses the latest recorded `archived_at`; it does not invent an installation timestamp or alter old rows at installation.

Preserve the failing a1953e3 evidence separately. No fixture, suite, or generated SQL in this directory authorizes production execution.
