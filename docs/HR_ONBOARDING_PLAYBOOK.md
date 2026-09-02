# HR Playbook — Requisition to Onboarding Complete

**System:** Phaze ERP  
**Audience:** HR, hiring managers, vertical owners, CEO/Super Admin, Admin, SCM  
**Purpose:** Operate the controlled hiring workflow from an approved need through a completed employee record, system access, and joining provisions.

## The lifecycle at a glance

`Need raised → Vertical approval → CEO approval → Job posted → Interviewing → Applicant selected → Offer drafted → Offer approved → Sent → Accepted → Employee onboarded → Access granted → Provisioning completed`

Three events must never be confused:

- **Selected** means HR chose the applicant for an offer. It is not a hire.
- **Accepted** means the candidate accepted a fully approved offer. It unlocks onboarding.
- **Candidate Selected / Fulfilled** means onboarding created the Employee record. This is the terminal requisition stage.

## Roles and responsibilities

| Role | Responsibility |
|---|---|
| Hiring Manager / requester | Raises the requisition for their own vertical; monitors progress; may cancel only while approval is pending. |
| Vertical owner | Gives the first requisition approval and first offer-letter approval. Cannot approve their own request. |
| CEO / Super Admin | Gives final approval. Acts as fallback only when the vertical has no eligible owner. |
| HR | Publishes application links, manages applications, selects the applicant, drafts and sends the offer, records the answer, and completes onboarding. |
| Admin / Super Admin | Grants login access after HR creates the employee record. |
| Provisioning approvers / SCM | Approve and fulfil joining items such as email, ID card, laptop, business card, and joining kit. |

## Before raising a requisition

1. Confirm the requester belongs to the correct vertical.
2. In Administration → Verticals, confirm that vertical has the correct owner.
3. Agree the position title, employment type, target joining date, annual CTC budget, justification, responsibilities, and measurable KPIs.
4. Raise one requisition per eventual hire. “Number of positions” creates separate, independently approved requisitions.

## 1. Raise the requisition

**Route:** HR → Candidate Requisitions

1. Select **Submit requisition** at the top of the register.
2. Complete **Request a position**:
   - Position title
   - Employment type
   - Target joining date (optional)
   - Annual CTC budget greater than zero
   - Number of positions (1–20)
   - Business justification
   - Key responsibilities
   - KPIs
3. Submit and confirm.

The system assigns a `REQ-YYYY-####` number. The requisition automatically belongs to the requester’s vertical; it is not chosen manually.

## 2. Complete approvals

Normal route:

1. Status becomes **Pending Vertical Approval**.
2. The vertical owner approves or rejects. Rejection requires a reason and ends that requisition.
3. Status becomes **Pending Super Admin Approval**.
4. CEO/Super Admin approves or rejects. Rejection requires a reason.
5. Approved requisitions enter recruitment.

Fallback route: when the vertical has no owner, or the owner is the requester and therefore conflicted, CEO/Super Admin may finalise directly. This is an exception—not the standard approval path.

## 3. Open recruitment and collect applications

Only HR manages applications.

1. Open an approved requisition and set hiring progress to **Job Posted**.
2. Generate a public application link; optionally protect it with a password.
3. Copy or email the existing link. Each candidate receives a separate email; recipient addresses are never exposed to other candidates.
4. Share any password separately.
5. The candidate enters contact and experience information and uploads a resume.
6. HR opens the requisition to review applications and download resumes.
7. Move applications through **Submitted**, **Under Review**, and **Interview Scheduled** as appropriate.
8. Set requisition progress to **Interviewing**.

Links are valid only while the requisition remains approved and unfulfilled. Once an accepted offer exists, applications close automatically.

## 4. Select the applicant

1. In the application list, mark the chosen applicant **Selected**.
2. Confirm no other live offer exists for the requisition.
3. The applicant appears under **Candidates awaiting an offer**.

Selection authorises an offer but does not close the requisition and does not create an Employee record.

## 5. Draft the offer

**Route:** HR → Offer Letters

1. Under **Candidates awaiting an offer**, select **Draft offer**.
2. Review or enter:
   - Position offered
   - Employment type
   - Date of joining
   - Place of posting
   - Territory (optional)
   - Monthly CTC
   - Reports To (optional)
   - Key responsibilities
   - KPIs
3. Save the content and preview the document.
4. Submit for approval.

The letter is anchored to the candidate application—not an Employee. The approved requisition prefills the role content. Annexure A is calculated from monthly CTC using the same compensation engine used at onboarding.

Submitting freezes the exact document for approval. Editing a pending or approved letter invalidates the approval and returns it to Draft. Editing a sent letter also withdraws the sent state and requires reapproval and resend.

## 6. Approve the offer

1. The position’s vertical owner opens **Offer Letter Approvals** and reviews the frozen document.
2. The owner approves and forwards it to the CEO, or rejects with a required comment.
3. CEO/Super Admin gives final approval.
4. For an ownerless or conflicted vertical, CEO/Super Admin uses **Review & approve** and finalises directly, stamping both approval stages.

The letter cannot be downloaded until fully approved.

## 7. Send and record the candidate’s answer

1. Download the fully approved letter.
2. Send it to the candidate through the agreed channel.
3. In ERP, select **Mark as sent**. The requisition moves automatically to **Offer Extended**.
4. Record one outcome:
   - **Candidate accepted** — unlocks onboarding, locks the agreed terms, and closes application links.
   - **Candidate declined** — enter the required reason. The application becomes Offer Declined, the requisition returns to Interviewing, and another applicant may be selected without a new requisition approval.

Internal approval and the candidate’s answer are separate axes. `APPROVED` means the company approved the letter; `acceptedAt` means the candidate accepted it. Both are required.

## 8. Onboard the accepted candidate

**Route:** People → Onboard Employee

Only HR staff, Admin, or Super Admin may onboard.

1. Select the accepted requisition. Only approved requisitions with an approved and accepted offer appear.
2. The system prefills the candidate name and the accepted offer terms.
3. The employee’s vertical is inherited from the requisition and locked. The backend rejects a different vertical.
4. Complete the five steps:
   - **Personal:** name, DOB, gender, personal email, mobile, emergency contact, optional photo.
   - **Employment:** official email, locked vertical, designation, employment type, joining date, location, territory.
   - **Compensation:** annual CTC and effective date; review the generated breakdown.
   - **Statutory:** PAN, Aadhaar last four digits, PF account, optional ESIC.
   - **Banking:** account number and IFSC.
5. Review all values and select **Onboard Employee**.

Completion creates the Employee record, salary structure, statutory and bank records, and a private **My Documents** Vault folder. It re-anchors the accepted offer to the Employee and marks the requisition **Candidate Selected / Fulfilled**. The same requisition cannot be onboarded twice.

The new employee starts with **Pending Access** and cannot log in yet.

## 9. Grant system access

An Admin or Super Admin completes the second onboarding step:

1. Open the pending-access employee record.
2. Confirm role, vertical, and reporting manager.
3. Set the initial password and activate access.
4. Share credentials through the approved secure channel and require the employee to change the password where applicable.

Granting access activates the account and creates all currently active provisioning requests.

## 10. Complete joining provisions

Provisioning items are configuration-driven. Typical items are laptop, Email ID, ID card, business card, and joining kit.

- Digital items: approval completes the request.
- Physical items: approval sends the item to SCM; SCM fulfils it; the request is then completed.
- Rejection requires a comment.
- HR tracks the employee checklist until every required item reaches a terminal state.

## 11. Employee check-in and check-out

**Route:** Account menu → My Profile → My Attendance

Attendance is employee self-service. The page presents one contextual action for the current day:

1. At the start of work, select **Check In**. The system records the current server time.
2. After check-in, the same action becomes **Check Out**.
3. At the end of work, select **Check Out**. The action then becomes the disabled **Done for today** state.
4. Review the attendance history table to confirm the recorded check-in and check-out times.

Attendance status is derived—not manually stored—from recorded times and approved leave:

- **Present:** attendance has the required recorded times.
- **Half Day / Absent:** derived according to the attendance rules and available times.
- **On Leave:** an approved leave request covers the date; no check-in is required.

Employees can record attendance only for themselves. They cannot overwrite a time, check in for another person, or submit a correction request inside ERP. If a punch is missing or wrong, the employee must contact HR or their manager through the agreed internal channel and provide the correct date and times.

## 12. Attendance corrections

**Route:** Leave & Attendance → Attendance Corrections

This is a controlled administrative correction—not a second check-in mechanism.

1. Search for and select the employee.
2. Select the attendance date.
3. The system loads the existing attendance record; if none exists, the correction can create it.
4. Enter or correct the check-in and check-out times.
5. Compare the proposed times with the supporting evidence or manager confirmation.
6. Select **Save correction** and confirm the audit warning.
7. Reopen the employee/date and verify the saved times and derived status.

Who may correct attendance:

- Admin or Super Admin.
- A Manager in the HR vertical.
- Other employees, ordinary managers, and HR employees without the required manager/admin authority cannot use this screen.

Every correction is audited. HR should retain the business reason and supporting evidence according to policy, even though the correction screen records the corrected times rather than a free-text employee request. Never use attendance correction to override approved leave without first resolving the leave record.

### Attendance exception guide

| Situation | Required action |
|---|---|
| Employee forgot to check in | Verify arrival evidence/manager confirmation, then create or correct the record. |
| Employee forgot to check out | Verify departure time, then add the missing check-out. |
| Wrong time recorded | Confirm the correct value before replacing it; the administrative action is audited. |
| Approved leave appears as On Leave | No correction is needed unless the leave record itself is wrong. |
| Employee asks for self-service correction | Explain that no self-service correction workflow exists; HR/Admin must perform it. |
| Correction screen is unavailable | Confirm the user is Admin/Super Admin or an HR-vertical Manager. |

## 13. Payroll operations

Payroll is the recurring close of the onboarding cycle. Access is limited to Admin, Super Admin, and Managers in the HR vertical. The quality of each run depends on the employee master, effective salary structure, statutory setup, approved unpaid leave, and payroll period all being correct before processing.

### A. Confirm payroll readiness

Before creating the monthly run:

1. Confirm every employee to be paid is **Active**. Payroll processes all active employees; it is not an employee-by-employee selection screen.
2. Confirm each active employee has the correct effective-dated salary structure under **Administration → Salary Structures**. Onboarding creates the first structure from the accepted offer CTC; later revisions append a new effective-dated row and preserve history.
3. Confirm PAN, PF, ESIC where applicable, banking details, work location, and other payroll master data are complete.
4. Resolve leave and attendance issues before close. Approved **Unpaid Leave** is used to calculate the unpaid-leave deduction for the payroll month.
5. Under **Administration → Statutory Configuration**, confirm effective PF, ESI, TDS slab, standard deduction, and applicable professional-tax configuration. These values are intentionally not assumed by the system; missing required configuration blocks the whole run.

### B. Create and process the monthly run

**Route:** Administration → Payroll Runs

1. Select **New Payroll Run**.
2. Choose the month and year, then create. Only one run can exist for a payroll period.
3. Open the new **Draft** run and select **Process Payroll**.
4. Confirm the action. The system computes payroll for every active employee using the effective salary structure, statutory configuration, and approved unpaid leave.
5. Wait for the run to reach **Completed**. Processing creates one payslip per included employee.

Processing is atomic: if any employee is missing a required salary structure, statutory setup is incomplete, or another computation fails, no partial payroll is retained and the run returns to Draft. Correct the source data and process the same run again.

### C. Review payslips before locking

For each generated payslip, review at least:

- Employee and payroll period.
- Gross earnings and salary components.
- Employee and employer PF/ESI where applicable.
- Professional tax, TDS, and unpaid-leave deduction.
- Net pay.

Investigate unexpected values against the employee’s effective salary structure, location, statutory master, and approved unpaid leave. Do not lock merely because processing completed.

### D. Lock and distribute

1. After the register and employee-level payslips are reconciled, select **Lock Run**.
2. Confirm only when authorised. A locked payroll run is final and cannot be edited.
3. Employees can view their own generated payslip under **My Payslips** when payslip self-service is enabled. Administrators may open payslip detail from the payroll run.
4. Follow the organisation’s separate banking/payment and statutory-filing controls; ERP payslip generation does not by itself prove that funds were transferred or returns were filed.

### Payroll exception guide

| Situation | Required action |
|---|---|
| Payroll will not process and cites StatutoryConfig | Add or correct the required effective statutory configuration, then retry the Draft run. |
| Active employee has no salary structure | Create the correct effective-dated structure, verify the breakdown, then retry. |
| Wrong CTC or component appears | Correct the source salary structure with the proper effective date; never overwrite historical evidence. |
| Unpaid-leave deduction is unexpected | Verify approved Unpaid Leave dates for that payroll month before processing or locking. |
| Processing fails part-way | No partial payslips should remain; the run returns to Draft. Correct the cause and retry. |
| Error found after Completed but before Lock | Correct the underlying source data and escalate before locking; do not finalise a known error. |
| Error found after Lock | Do not alter the locked period. Record an authorised adjustment in a future payroll period. |
| Employee cannot see a payslip | Confirm the run produced their payslip, the employee is opening their own record, and payslip self-service is enabled. |

## Control checklist

### Before submitting a requisition

- [ ] Requester is in the correct vertical.
- [ ] Correct vertical owner is assigned.
- [ ] Budget is approved internally and greater than zero.
- [ ] Responsibilities and KPIs are specific and measurable.
- [ ] Number of positions matches the number of separate hires required.

### Before sending an offer

- [ ] Candidate application is Selected.
- [ ] Position, type, joining date, location, CTC, responsibilities, and KPIs are correct.
- [ ] Reports To is correct or intentionally blank.
- [ ] Vertical owner and CEO approvals are recorded.
- [ ] Downloaded letter matches the frozen approved preview.

### Before onboarding

- [ ] Offer status is Approved.
- [ ] Offer is marked Sent.
- [ ] Candidate acceptance is recorded.
- [ ] Requisition vertical is correct; do not work around the locked vertical.
- [ ] Personal, statutory, bank, and compensation evidence is available.

### Before declaring onboarding complete

- [ ] Employee record created and requisition reads Fulfilled.
- [ ] Offer letter is linked to the employee.
- [ ] Official email and reporting manager confirmed.
- [ ] Admin granted access.
- [ ] Required provisioning requests completed or actively owned.
- [ ] Sensitive records were handled only in the authorised HR workflow.

### Attendance operations

- [ ] New employee knows where to find My Attendance.
- [ ] Employee understands Check In → Check Out → Done for today.
- [ ] Employee knows approved leave does not require a check-in.
- [ ] Employee knows corrections must be requested from HR/Admin out of band.
- [ ] Correction operator verified the employee, date, evidence, and both times.
- [ ] Corrected record was reopened and checked after saving.

### Payroll close

- [ ] Active employee population is correct.
- [ ] Effective salary structures and revisions were reviewed.
- [ ] Statutory, banking, location, leave, and attendance inputs are complete.
- [ ] The payroll period is correct and no duplicate run exists.
- [ ] Processing completed without an unresolved exception.
- [ ] Gross, deductions, employer contributions, unpaid leave, and net pay were reconciled.
- [ ] An authorised reviewer approved locking the run.
- [ ] Payment and statutory filing evidence is tracked outside the payslip-generation status where required.

## Exceptions and recovery

| Situation | Required action |
|---|---|
| Vertical has no owner | Assign the correct owner if possible. CEO fallback may finalise the pending approval. |
| Vertical owner raised the requisition | Self-approval is blocked; CEO fallback finalises. |
| Requisition rejected | Raise a new corrected requisition. Rejection is terminal. |
| Candidate declines | Record decline reason. Requisition returns to Interviewing; select another applicant. |
| Offer terms change after approval/sending | Edit the letter; it returns to Draft and must be reapproved and resent. |
| Candidate has not accepted | Do not onboard. Record acceptance first. |
| Wrong vertical appears during onboarding | Stop and correct the requisition/vertical master data. The onboarding API will reject a mismatch. |
| Employee created but cannot log in | Expected until Admin grants access. Check Pending Access. |
| Payroll cannot include a new joiner | Confirm the Employee is Active and has an effective salary structure for the payroll period. |
| Payroll error discovered after lock | Preserve the locked run and post an authorised correction in a future period. |

## Data handling

- Candidate resumes, personal details, CTC, PAN, PF, ESIC, and banking information are confidential.
- Use public application links only for the intended requisition; revoke obsolete links.
- Email candidates separately. Never expose a shortlist through a shared recipient list.
- Do not send link passwords in the same application-link email.
- Do not use Administration → Create Employee for a genuine hire; that shortcut bypasses the controlled requisition, offer, acceptance, and HR onboarding record.
