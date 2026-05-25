# Trennen Retention Schedule

This schedule aligns the app's cleanup controls with New Zealand privacy and record-keeping expectations. It should be reviewed with NZ counsel and updated whenever processors, storage locations, or legal obligations change.

## Defaults

- Reset tokens: purge expired or used customer, shop, and platform reset tokens after 7 days.
- Sessions: purge expired shop sessions after 30 days and expired app sessions as they expire.
- Saved quotes: purge payloads for deleted or expired saved quotes after 30 days by clearing quote request, quote snapshot, file metadata, and selection JSON.
- Routine email-delivery events: purge ordinary delivery logs after 180 days. Keep bounce, complaint, and suppression records while needed for deliverability and abuse prevention, with periodic review.
- Orders, payment identifiers, fee ledgers, restricted-item certifications, and accounting records: retain for 7 tax years, then anonymise direct identifiers where feasible unless a dispute, safety issue, fraud issue, or legal hold applies.
- Backups: keep operational backups on a documented rolling schedule. Deletion requests may lag until backup expiry unless a legal or security hold applies.

## Operating Notes

- Run `npm run retention:dry-run` before applying cleanup in production.
- Review the dry-run summary before `npm run retention:apply`.
- Back up the SQLite database and uploads before any production apply run.
- Privacy Act principle 9 says agencies must not keep personal information longer than required for lawful purposes: https://www.privacy.org.nz/privacy-principles/9/
- IRD guidance says business records should generally be kept for at least 7 tax years: https://www.ird.govt.nz/managing-my-tax/record-keeping
