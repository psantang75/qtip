---
key: tech-ticket-process
name: Tech Ticket Process
owner_dept: Tech Support
always_include_urls:
  - http://know.crm.dm-us.com/books/job-billing-customer-service/page/ticket-handling-process
  - http://know.crm.dm-us.com/books/job-billing-customer-service/page/how-to-open-a-new-ticket
---

Description grading:
- The Description field must restate what the customer reported, in the customer's words after intake (e.g. "player showing Server Unreachable"). A vague description like "music not playing" is a documentation gap when the notes show a more specific symptom.
- Compare the description against the chosen Class/Subclass: do the documented rules and steps for that subclass actually fit what the description says? If yes, the agent satisfied the description and should receive full credit on the description-related questions.

Class / Subclass / Resolution evaluation:
- Use the KB pages for the matching subclass to evaluate whether the right steps were followed. Do NOT reference the page titled "Ticket/Task Classification/Sub Classifications & Resolutions" — that page is just a list of valid options, not a reference for how to handle the work.
- Resolution is judged against the actions and outcome documented in the notes — NOT against a literal "Resolution: …" line. If the closing notes show the outcome being achieved (e.g. "power-cycle restored service", "customer confirmed playback resumed", "satellite radio activation completed"), that supports a chosen Resolution even when the agent never restated the resolution wording inside the notes themselves.
- If the matching subclass has no playbook KB page (example: "Activate Satellite Radio" currently has no documented playbook), do the classification-text KB search and treat the returned pages as the documented process. Add an `observation` of kind `documentation` noting the missing playbook so QA can prioritize creating it.

Timeline + cadence:
- Always trace the notes timeline against the "Ticket Handling Process" and "How to Open a New Ticket" KB pages. These two pages define the universal cadence for tech tickets — every tech ticket review should reference them when evaluating follow-ups, status changes, and closure.
- Confirm follow-up notes were left at the cadence the KB calls for. Cadence drift goes into `observations` (not the score) unless the form explicitly grades cadence.

Common advisory observations to flag (non-scored):
- Cut-and-paste notes that don't add new information for the day they were left.
- Vague descriptions that don't restate the customer's specific symptom.
- Missing customer identity verification when the ticket touches account changes.
- Ambiguous next steps in the most recent open note.
- Any PII captured in notes that doesn't belong there (full credit card numbers, full SSN, etc.).
