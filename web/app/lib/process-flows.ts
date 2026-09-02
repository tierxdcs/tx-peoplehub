/**
 * Static, hardcoded end-to-end process overviews (spec §6). These change rarely,
 * so they live here as a plain data array — a one-file edit to update, no admin
 * machinery. Each step has a short label, a few lines of detail, and a `gate`
 * flag marking approval / QC / sign-off points (where people get blocked and
 * most need to understand why).
 *
 * The first entries are the per-vertical flows (their `codes` match
 * `Vertical.code`, so `flowForVertical` maps a user's vertical to one). The
 * remaining entries are cross-cutting sub-processes that don't map to a single
 * vertical — they use synthetic codes and are explorable only from Help/Learning.
 *
 * Live per-record flow indicators (§7) live separately in `record-flows.ts`.
 */

export interface FlowStep {
  key: string;
  label: string;
  detail: string;
  gate?: boolean;
  /** Optional in-app destination used by Help/Learning; dashboard stays compact. */
  href?: string;
}

export interface VerticalFlow {
  /** Vertical codes this flow applies to (matches Vertical.code), or a synthetic code for cross-cutting flows. */
  codes: string[];
  title: string;
  summary: string;
  participants: string;
  steps: FlowStep[];
}

export const VERTICAL_FLOWS: VerticalFlow[] = [
  {
    codes: ['SALES'],
    title: 'Sales — Lead to Order',
    summary:
      'Turn a customer enquiry into an approved, confirmed order and hand it over cleanly for execution.',
    participants:
      'Sales employees, Sales Managers, Sales Head and the customer',
    steps: [
      {
        key: 'lead',
        label: 'Lead',
        detail:
          'A new prospect enters the pipeline from an enquiry, referral, campaign or walk-in. Capture the company, the contact and what they are looking for so nothing is lost. Every deal starts here, even if it later links to an existing customer.',
        href: '/sales/leads',
      },
      {
        key: 'qualify',
        label: 'Qualify',
        detail:
          'Check whether the prospect is a genuine fit — the right product area, a real budget and a decision timeline. Weak or duplicate leads are parked here rather than clogging the pipeline. Qualifying early keeps the team focused on winnable work.',
      },
      {
        key: 'opportunity',
        label: 'Opportunity',
        detail:
          'A qualified lead becomes a tracked opportunity with an expected value and close date. Sales works the relationship, gathers requirements and shapes the solution. This is where most of the pre-sales effort lives.',
        href: '/sales/opportunities',
      },
      {
        key: 'assessment',
        label: 'Bid/No-Bid',
        detail:
          'Before investing in a full proposal, the Sales Head decides Bid or No-Bid using a structured assessment. This gate stops the team pouring effort into deals we cannot win or do not want. A No-Bid closes the opportunity cleanly, with the reason recorded.',
        gate: true,
      },
      {
        key: 'strategy',
        label: 'Bid strategy',
        detail:
          'When a deal needs alignment, Sales records one or more Strategy Meetings on the Bid before any order exists. Add internal employees or external participants, capture the discussion and decisions, and assign lightweight Open or Done follow-ups with owners and due dates. These actions stay with the Bid and do not create a Kanban board; if the deal is won, Project Kickoff can read the earlier meetings as context.',
        href: '/sales/bids',
      },
      {
        key: 'customer-bom',
        label: 'Customer BOM intake',
        detail:
          'For a custom product, Sales uploads the customer parts list from the Opportunity and transcribes its lines without adding internal costs or engineering classifications. Every line is searched against Item Master and deliberately matched or created as a new Component, producing a real Product and Draft BOM. SCM may source BUY components while quoting, but R&D must review and release the BOM before the accepted Bid can become an Order.',
        href: '/sales/opportunities',
      },
      {
        key: 'bid',
        label: 'Bid',
        detail:
          'A priced techno-commercial proposal is built line by line from products — or from ad-hoc placeholders for genuinely new items. Quantities, discounts and taxes roll up into the quoted total. The bid is a formal snapshot: its prices are fixed once it is created.',
        href: '/sales/bids',
      },
      {
        key: 'discount',
        label: 'Discount approval',
        detail:
          'When the overall discount crosses the policy threshold (over 10%), a manager must approve before the bid can go out. This protects margin and keeps pricing consistent across the team. Within the threshold the bid proceeds without a wait.',
        gate: true,
      },
      {
        key: 'accepted',
        label: 'Customer accepts',
        detail:
          'The customer accepts the proposal. Any ad-hoc placeholder lines must be resolved into real, costable products before the bid can convert. Acceptance is the trigger to raise the order.',
      },
      {
        key: 'order',
        label: 'Order',
        detail:
          'The accepted bid converts one-to-one into a confirmed sales order, carrying the agreed lines and prices. No order can reference a placeholder — everything is a real product by now. The order becomes the single source of truth for execution.',
        href: '/sales/orders',
      },
      {
        key: 'ocs',
        label: 'Confirmation Sheet',
        detail:
          'An Order Confirmation Sheet captures the final agreed scope; the customer signs and the Sales Head countersigns. This gate is the formal go-ahead that binds both sides. Only after it is signed does work release downstream.',
        gate: true,
      },
      {
        key: 'released',
        label: 'Released to production',
        detail:
          'The confirmed order is released for execution and a project kickoff is raised. Ownership passes from Sales to the delivery teams. Sales stays informed, but the build now drives the timeline.',
      },
    ],
  },
  {
    codes: ['RND'],
    title: 'R&D — BOM to Release',
    summary:
      'Define what must be built, review its technical structure and release a controlled BOM for execution.',
    participants: 'R&D employees, R&D Head, Production and SCM',
    steps: [
      {
        key: 'item',
        label: 'Item Master',
        detail:
          'Every part, sub-assembly and finished good is defined once in the Item Master with its code, unit of measure and technical data. This shared catalogue is what BOMs, costing and stock all reference. Getting the item right here prevents duplicates and confusion everywhere downstream.',
        href: '/scm/items',
      },
      {
        key: 'draft',
        label: 'BOM drafted',
        detail:
          'A multi-level bill of materials is built, nesting sub-assemblies to any depth with per-line quantities and wastage. The structure defines exactly what goes into the product. Drafts can be revised freely until they are submitted.',
        href: '/scm/bom',
      },
      {
        key: 'submitted',
        label: 'BOM submitted',
        detail:
          'The completed BOM is submitted for technical review and is locked from casual edits while it waits. Reviewers check the structure, quantities and material choices. Submission is the request for an accountable sign-off.',
      },
      {
        key: 'approved',
        label: 'R&D Head approves',
        detail:
          'Only a designated R&D Head can approve a BOM — this gate ensures an accountable technical sign-off. Approval confirms the structure is correct and buildable. A rejection sends it back with feedback for revision.',
        gate: true,
      },
      {
        key: 'released',
        label: 'BOM released',
        detail:
          'An approved BOM is released, locked and stamped with a revision number. Later changes create a new revision rather than overwriting history. The released revision is the only one execution is allowed to use.',
      },
      {
        key: 'available',
        label: 'Available for production',
        detail:
          'The released BOM becomes available to the rest of the business — driving the stock explosion at kickoff, resource planning and manufacturing. Any product without a released BOM cannot be planned or built. This is the handoff from engineering to execution.',
      },
    ],
  },
  {
    codes: ['DESIGN', 'ENGINEERING'],
    title: 'Design Engineering — Request to Production Release',
    summary:
      'Turn an approved design need into controlled drawings, reviews, customer approval and an auditable production handoff.',
    participants:
      'Design Engineering employees, Design Lead, Design Head, Project Manager, customer, Production, SCM and Quality',
    steps: [
      {
        key: 'request',
        label: 'Design request',
        detail:
          'Start by recording why design work is needed, whether it comes from a sales order, project kickoff, customer change, internal product development, NCR/CAPA or value-engineering request. Capture the scope and business context clearly so the Design team can prioritize the right work and trace every later decision back to its source.',
        href: '/design/requests',
      },
      {
        key: 'project',
        label: 'Design project',
        detail:
          'Convert the accepted request into a Design Project, assign its lead and target date, and link the relevant customer, product or order where available. The project moves through Requirements, Concept, Detailed Design, Internal Review, Customer Approval and Released for Production, giving everyone one visible lifecycle instead of separate informal updates.',
        href: '/design/projects',
      },
      {
        key: 'controls',
        label: 'Requirements & plan',
        detail:
          'Record measurable design requirements, decide how each requirement will be verified and establish the project milestones. Evidence is added against the requirement it proves, while milestone updates show whether the work is progressing to plan. This creates a clear definition of done before drawings are released.',
        href: '/design/controls',
      },
      {
        key: 'documents',
        label: 'Documents & revisions',
        detail:
          'Create controlled drawing and design-document records, then upload each revision through the existing Vault version-control mechanism. A new revision never overwrites the previous one, so reviewers, Production and auditors can always identify exactly which file and revision was current at any point in time.',
        href: '/design/documents',
      },
      {
        key: 'internal-review',
        label: 'Internal design review',
        detail:
          'Submit the design for an internal review with the right attendees, minutes, outcome and owned action items. Reviewers check technical completeness, manufacturability, safety, standards and open requirements. Any failed check or unresolved action sends the work back for correction before it can proceed.',
        gate: true,
        href: '/design/reviews',
      },
      {
        key: 'customer-approval',
        label: 'Customer approval',
        detail:
          'Where customer approval is required, record the decision against the exact submitted revision rather than relying on email history alone. A rejection or requested change creates a clear return path for revision; approval confirms that the customer accepted the controlled design being prepared for release.',
        gate: true,
        href: '/design/controls',
      },
      {
        key: 'release',
        label: 'Design Head release',
        detail:
          'The designated Design Head performs the final release after the required reviews, checks and approvals are complete. Release locks the approved revision as the production authority; draft or merely reviewed files must never be treated as shop-floor instructions.',
        gate: true,
        href: '/design/documents',
      },
      {
        key: 'transmittal',
        label: 'Controlled handoff',
        detail:
          'Issue the released documents through a Design Transmittal to Production, SCM, Quality or the customer. The transmittal identifies the exact documents and revisions sent, records issue and acknowledgement, and prevents teams from working from an outdated attachment or an uncontrolled local copy.',
        href: '/design/transmittals',
      },
      {
        key: 'change-control',
        label: 'Engineering changes',
        detail:
          'If the released design must change, raise an Engineering Change rather than editing the released file directly. Record affected items, assess cost, stock, schedule and quality impact, obtain approval, implement the new revision and collect acknowledgements; the Change Report preserves the complete before-and-after audit trail.',
        gate: true,
        href: '/design/changes',
      },
    ],
  },
  {
    codes: ['SCM'],
    title: 'SCM — Need to Purchase Order',
    summary:
      'Convert a confirmed material need into a fair supplier selection, purchase order and receipt.',
    participants:
      'SCM employees, Project Managers, suppliers, Stores and Quality',
    steps: [
      {
        key: 'need',
        label: 'Material need',
        detail:
          'A material need may come from a kickoff stock shortfall, an order’s released BOMs, or a quote-stage customer Draft BOM. When an order or BOM is selected, the system performs the same Make/Buy-aware multi-level explosion used by planning: MAKE assemblies recurse and only BUY components become sourcing lines. Repeated components are aggregated, avoiding manual re-entry and accidental external sourcing of in-house work.',
      },
      {
        key: 'rfq',
        label: 'RFQ',
        detail:
          'SCM reviews the auto-populated lines, excludes any order product that is out of scope, and can edit quantities or add and remove materials before saving the Draft RFQ. Link it to the relevant Project/Order where available for internal traceability. Customer identity, order number and commercial order information stay internal and are never shown on the vendor quote form.',
        href: '/scm/rfqs',
      },
      {
        key: 'technical-pack',
        label: 'BOM & drawings',
        detail:
          'For each RFQ line, the vendor sees a live read-only view of the current BOM without internal cost or pricing. SCM can attach private technical drawings either to the whole RFQ or to one line, and can delete a mistaken upload before issue. Downloads use short-lived links available only through that vendor’s valid RFQ invitation; after award, losing vendors lose access while the winner retains it.',
      },
      {
        key: 'pm-approval',
        label: 'Project Manager approval',
        detail:
          'The linked Project Manager reviews the Draft RFQ before vendor invitation links can be generated. Approval unlocks issuing; rejection returns it to SCM with a mandatory explanation so it can be corrected and resubmitted. This gate ensures the sourcing scope matches the project need before external parties see it.',
        gate: true,
      },
      {
        key: 'quotes',
        label: 'Sealed quotes',
        detail:
          'After approval, SCM adds at least three qualified suppliers or vendors and issues their private invitation links. Invitees see the sourcing requirements, live BOM view and authorised drawings, then save or submit their quote. Quotes stay sealed from internal users until the RFQ closes, preventing early bids from being leaked or shopped around.',
      },
      {
        key: 'compare',
        label: 'Comparison',
        detail:
          'Once closed, all quotes are revealed and compared side by side on price, lead time and terms. The comparison makes the trade-offs explicit. It is the basis for a defensible award decision.',
      },
      {
        key: 'award',
        label: 'Award',
        detail:
          'SCM awards the RFQ to the chosen supplier; selecting a quote other than the lowest requires a written justification. This gate keeps the decision transparent and auditable, revokes technical access for non-winners, and creates a Draft Purchase Order pre-filled from the winning quote for final review.',
        gate: true,
      },
      {
        key: 'po',
        label: 'Purchase Order',
        detail:
          'A draft purchase order is pre-filled directly from the winning quote, carrying its prices and terms. The buyer reviews and issues it to the supplier. Issuing the PO is the formal commitment to buy.',
        href: '/stores/purchase-orders',
      },
      {
        key: 'received',
        label: 'Goods received',
        detail:
          'When goods arrive, Stores records a Goods Receipt Note against the PO and hands the material to incoming quality. Partial receipts are tracked until the PO is fully received. This closes the sourcing loop.',
      },
    ],
  },
  {
    codes: ['PRODUCTION'],
    title: 'Production / Stores — Receipt to Dispatch',
    summary:
      'Receive material safely, control stock, support manufacturing and release finished goods for dispatch.',
    participants: 'Stores, Production, Quality, SCM and Logistics',
    steps: [
      {
        key: 'po',
        label: 'PO issued',
        detail:
          'A purchase order commits the company to buy specific materials from a supplier. It sets the expectation for what Stores should receive and when. Production planning depends on these arriving on time.',
      },
      {
        key: 'grn',
        label: 'GRN on receipt',
        detail:
          'On receipt, Stores raises a Goods Receipt Note capturing what physically arrived. Crucially the goods are recorded but not yet usable stock — they must clear quality first. This separation stops unchecked material reaching the floor.',
        href: '/stores/grn',
      },
      {
        key: 'qc',
        label: 'QC inspection',
        detail:
          'Incoming QC inspects the received material before it can be stocked. This gate is where sub-standard material is caught at the door. Only the accepted quantity moves forward.',
        gate: true,
      },
      {
        key: 'stock',
        label: 'Stock / NCR',
        detail:
          'Accepted quantity is taken into stock and becomes available to issue; rejected quantity raises a Non-Conformance Report. The NCR drives the return or rework decision with the supplier. Stock levels now reflect what is genuinely usable.',
      },
      {
        key: 'indent',
        label: 'Material indent',
        detail:
          'Production raises a material indent for what a work order needs, naming the items and quantities required from stores. This is the formal request that drives an issue. It links planned consumption to a specific job.',
        href: '/stores/material-issue',
      },
      {
        key: 'issue',
        label: 'Material issued',
        detail:
          'Stores issues material against the indent, aware of any reservations so committed stock is not double-spent. Quantities are deducted from stock as they leave. The issue ties actual consumption back to the job.',
      },
      {
        key: 'manufacture',
        label: 'Manufacturing',
        detail:
          'The work order is built on the floor using the issued material and the released BOM. Progress is tracked until the product is complete. This is where raw material becomes finished goods.',
      },
      {
        key: 'finalqc',
        label: 'Final QC',
        detail:
          'Final QC inspects the finished product before it may ship. This gate protects the customer from receiving defective goods. Only cleared goods can be dispatched.',
        gate: true,
      },
      {
        key: 'dispatch',
        label: 'Dispatch',
        detail:
          'Dispatch raises a delivery challan, removes the goods from stock and seeds a draft sales invoice for Finance. It is the physical handover to logistics. The order now moves toward delivery and billing.',
        href: '/logistics/dispatch',
      },
    ],
  },
  {
    codes: ['QUALITY', 'QMS'],
    title: 'Quality — Incoming to Final',
    summary:
      'Protect product quality from incoming material through final customer-ready clearance.',
    participants:
      'Quality inspectors, QMS Head, Stores, Production and suppliers',
    steps: [
      {
        key: 'incoming',
        label: 'Incoming QC',
        detail:
          'Quality inspects material received against a GRN before it can enter stock. This first gate keeps defective inputs out of the building. Findings are recorded against the specific receipt.',
        gate: true,
        href: '/qms/inspections',
      },
      {
        key: 'ncr',
        label: 'Accept / reject',
        detail:
          'Any rejection raises a Non-Conformance Report that drives a disposition — return, rework, use-as-is or scrap. The NCR keeps a traceable record of the problem and the decision. It also feeds supplier-quality trends.',
      },
      {
        key: 'inprocess',
        label: 'In-process checks',
        detail:
          'In-process checks verify quality at defined points during manufacturing, not just at the ends. Catching drift early avoids scrapping finished work. Results build the quality history of the job.',
      },
      {
        key: 'final',
        label: 'Final QC clearance',
        detail:
          'A final QC clearance is mandatory before anything is dispatched to the customer. This gate is the last line of defence on product quality. Nothing ships without it.',
        gate: true,
      },
    ],
  },
  {
    codes: ['ACCOUNTS'],
    title: 'Accounts — Invoice to Receipt',
    summary:
      'Review, approve and post customer invoices, then record and allocate receipts accurately.',
    participants: 'Finance employees, Accounts Head, Sales and the customer',
    steps: [
      {
        key: 'draft',
        label: 'Draft invoice',
        detail:
          'When goods are dispatched, the system seeds a draft sales invoice from the order and challan. Finance starts from real delivery data rather than a blank form. The draft can be reviewed and adjusted before it goes anywhere.',
        href: '/finance/ar/invoices',
      },
      {
        key: 'submit',
        label: 'Finance submits',
        detail:
          'Finance checks the draft for accuracy — amounts, taxes and customer details — then submits it for approval. Submitting locks the figures pending sign-off. Errors caught here avoid credit notes later.',
      },
      {
        key: 'approve',
        label: 'Accounts Head approves',
        detail:
          'The Accounts Head is the single approver who signs off the invoice. This gate ensures one accountable review before anything posts to the ledger. A rejection returns it to Finance with a reason.',
        gate: true,
      },
      {
        key: 'issued',
        label: 'Issued & posted',
        detail:
          'The approved invoice is issued to the customer and posted to the general ledger. Revenue and receivables are now recognised. The invoice becomes a live item awaiting payment.',
      },
      {
        key: 'receipt',
        label: 'Customer receipt',
        detail:
          'When the customer pays, the receipt is recorded against their account. Part-payments are supported and tracked. This is the money actually arriving.',
      },
      {
        key: 'allocated',
        label: 'Allocated',
        detail:
          'The receipt is allocated against the specific invoice(s) it settles, clearing the receivable and keeping the customer ledger accurate. Any unallocated balance stays visible for follow-up. Allocation is what closes the loop on a sale.',
      },
    ],
  },
  {
    codes: ['HR'],
    title: 'HR — Hiring Request to Payroll',
    summary:
      'Authorise a hire, track recruitment, issue the approved offer, onboard the confirmed candidate and support their ongoing employment.',
    participants:
      'HR employees, hiring Managers, vertical owners, SuperAdmin and the employee',
    steps: [
      {
        key: 'requisition',
        label: 'Hiring requisition',
        detail:
          'A Manager or above requests one position for their own vertical, including the role, employment type, CTC budget, business justification, Key Responsibilities and KPIs. The requester’s vertical owner approves first, followed by the CEO; an ownerless vertical routes directly to the CEO. Approval authorises one hire and does not by itself mean a candidate has been selected.',
        href: '/hr/candidate-requisitions',
        gate: true,
      },
      {
        key: 'recruitment',
        label: 'Recruitment progress',
        detail:
          'After approval, HR publishes the application link and moves the position through Job Posted and Interviewing, marking one applicant Selected. Selection authorises an offer — it is not the hire. The later stages are not set by hand: sending the approved offer moves the position to Offer Extended, and onboarding the candidate who accepted it makes it Candidate Selected, shown as Fulfilled. The requester, vertical owner and CEO follow progress read-only in the Requisition Register.',
        href: '/hr/candidate-requisitions',
      },
      {
        key: 'offer',
        label: 'Offer Letter',
        detail:
          'HR drafts the Offer Letter for the Selected applicant — before any employee record exists — quoting the position, joining date, place of posting and monthly CTC. Key Responsibilities and KPIs are pre-filled from the approved request and remain editable; Annexure A is computed from the offered CTC by the same calculator payroll uses. Submitting freezes the exact document for the vertical owner’s approval, with the CEO as fallback when no owner is assigned. One requisition carries one live offer at a time.',
        href: '/hr/offer-letters',
        gate: true,
      },
      {
        key: 'answer',
        label: 'Candidate’s answer',
        detail:
          'The approved letter goes to the candidate and HR records it as sent, which extends the offer. Their answer is recorded against the letter: an acceptance is what authorizes onboarding and closes the position’s application links, while a decline (with its reason) returns the position to Interviewing so another applicant can be selected — no re-raising or re-approving the requisition.',
        href: '/hr/offer-letters',
        gate: true,
      },
      {
        key: 'onboard',
        label: 'Employee onboarding',
        detail:
          'HR creates the employee master record with personal, employment, compensation, statutory and bank details. Only a requisition whose candidate accepted an approved Offer Letter can be linked, and every term — name, designation, employment type, joining date, place of posting and compensation — is filled from the letter they accepted, so the record and their first salary structure cannot disagree with what was signed. HR reviews every value before completion, and the same requisition cannot be linked to a second onboarding.',
        href: '/hr/onboard',
      },
      {
        key: 'access',
        label: 'Access granted',
        detail:
          'The onboarded employee starts with Pending Access. An authorised administrator assigns the role, vertical and reporting manager, activates the official email login and sets the initial password. Activation also creates the configured provisioning requests, so access is granted deliberately and the joining checklist begins from one real event.',
        gate: true,
      },
      {
        key: 'provisioning',
        label: 'Joining provisions',
        detail:
          'Laptop, Email ID, ID Card, Business Card, Joining Kit and any future active item types are routed to their configured approver. Digital actions complete with the approver; approved physical items move to SCM for fulfilment. HR follows the employee’s checklist until every required item reaches its final state.',
        href: '/hr/provisioning-approvals',
      },
      {
        key: 'leave',
        label: 'Leave & attendance',
        detail:
          'Day-to-day people operations run here: leave requests, attendance and approvals. Managers approve within policy and balances update automatically. This keeps the workforce picture current.',
      },
      {
        key: 'payroll',
        label: 'Payroll',
        detail:
          'Payroll processes salaries monthly from attendance, leave and the salary structure, generating statutory deductions and payslips. It is the recurring close of the HR cycle. Accurate upstream data is what makes it painless.',
      },
    ],
  },

  // ── Cross-cutting sub-processes (synthetic codes; Help/Learning only) ────
  {
    codes: ['BID_STRATEGY'],
    title: 'Bid Strategy — Align Before Quoting',
    summary:
      'Record pre-bid discussions, decisions and follow-ups while the opportunity is still being pursued.',
    participants:
      'Sales employees, Sales Managers, solution stakeholders and invited external participants',
    steps: [
      {
        key: 'open-bid',
        label: 'Open the Bid',
        detail:
          'Open the relevant Bid and find Strategy Meetings. The meeting belongs to the Bid, so it can be held before an Order or Project Kickoff exists. Any user who normally has access to the Bid can use this section.',
        href: '/sales/bids',
      },
      {
        key: 'record-meeting',
        label: 'Record the meeting',
        detail:
          'Choose New Meeting and enter the date and time, mode, virtual link when applicable, and a clear summary of the approaches discussed and decisions made. A Bid can carry several meetings, so record each meaningful alignment separately instead of overwriting earlier context.',
      },
      {
        key: 'attendees',
        label: 'Add participants',
        detail:
          'Add colleagues by selecting their Employee record and add customers, advisers or other outside participants as external names. Keeping internal and external attendees distinct preserves an honest record of who contributed without creating accounts for guests.',
      },
      {
        key: 'actions',
        label: 'Assign follow-ups',
        detail:
          'Capture each follow-up with an internal owner and optional due date, then move it between Open and Done from the meeting. These are intentionally lightweight Bid actions and do not create Kanban cards or a premature project board.',
      },
      {
        key: 'handoff',
        label: 'Carry context forward',
        detail:
          'If the Bid is won, the resulting Project Kickoff shows a read-only reference to the earlier Strategy Meetings. The Project Manager can understand the commercial and technical thinking without making Kickoff depend on a meeting having taken place.',
      },
    ],
  },
  {
    codes: ['CUSTOMER_BOM'],
    title: 'Customer BOM — Intake to Quote-Stage Sourcing',
    summary:
      'Turn a customer parts list into controlled internal records that Sales, SCM and R&D can safely use.',
    participants: 'Sales employees, SCM, R&D and Design',
    steps: [
      {
        key: 'start',
        label: 'Start from Opportunity',
        detail:
          'Open the Opportunity and choose Customer BOM Intake when the requested product does not yet have a controlled internal BOM. Upload the customer PDF, spreadsheet or CSV and enter the product name, business unit, unit of measure and optional target margin.',
        href: '/sales/opportunities',
      },
      {
        key: 'transcribe',
        label: 'Enter customer lines',
        detail:
          'Transcribe each customer line with its description, customer part reference, quantity and unit. Keep this faithful to the customer document; Sales should not enter internal cost, sourcing classification or engineering assumptions here.',
      },
      {
        key: 'resolve',
        label: 'Resolve every item',
        detail:
          'Search Item Master for each line and select the correct existing match, or explicitly confirm that a new Component should be created. This deliberate resolution prevents near-duplicate materials from quietly entering the master data.',
        gate: true,
      },
      {
        key: 'create',
        label: 'Create Product & Draft BOM',
        detail:
          'Submitting creates a real Product, the resolved Item records and a Draft BOM. New lines default to BUY so SCM can request supplier prices during the quote stage. The displayed BOM estimate and suggested selling price remain live as item costs and awarded RFQ prices become available.',
      },
      {
        key: 'review',
        label: 'R&D reviews and releases',
        detail:
          'R&D reviews the customer-derived Draft, corrects classifications or structure, merges duplicates when needed, and follows the normal technical approval and release workflow. Quote-stage sourcing may proceed from the Draft, but Order conversion is blocked until the BOM is Released.',
        gate: true,
        href: '/scm/bom',
      },
    ],
  },
  {
    codes: ['RFQ_SOURCING'],
    title: 'RFQ Sourcing — Need to Award',
    summary:
      'Build a traceable sourcing package, obtain Project Manager approval and run a fair sealed comparison.',
    participants:
      'SCM employees, Project Managers, suppliers, vendors and purchase-order owners',
    steps: [
      {
        key: 'source',
        label: 'Choose the source',
        detail:
          'Create an RFQ and optionally select a Project/Order or a quote-stage Customer BOM. For an order, decide which product lines are in scope. The link is for internal traceability and auto-population only; the public form does not expose the customer or order.',
        href: '/scm/rfqs',
      },
      {
        key: 'explode',
        label: 'Review sourcing lines',
        detail:
          'The system explodes the selected BOMs through MAKE assemblies, surfaces only BUY materials and aggregates repeated components. Review the item, required quantity and unit, then adjust, remove or add lines as this RFQ requires. With no released BOM, the form stays usable and prompts for manual lines.',
      },
      {
        key: 'documents',
        label: 'Prepare technical pack',
        detail:
          'Check the live, cost-free BOM view and attach drawings to either the whole RFQ or the relevant line. Remove any incorrect upload before issuing. Files remain private and are downloaded only through short-lived links authorised by each RFQ invitation.',
      },
      {
        key: 'approve',
        label: 'Project Manager approves',
        detail:
          'Submit the Draft RFQ to the linked Project Manager. Until they approve, SCM cannot generate vendor quote links or issue the RFQ. A rejection includes the correction needed and returns the RFQ to an editable Draft for resubmission.',
        gate: true,
      },
      {
        key: 'invite',
        label: 'Invite and receive quotes',
        detail:
          'After approval, add the required qualified suppliers or vendors and issue the RFQ. Each invitee uses their own protected public form to review requirements and submit pricing. Internal users cannot see quote values before closure.',
      },
      {
        key: 'compare',
        label: 'Compare after close',
        detail:
          'At the deadline, or after SCM closes the RFQ, compare responses side by side across price, lead time and commercial terms. Technical content and quote access remain scoped to the invited party throughout the process.',
      },
      {
        key: 'award',
        label: 'Award and create Draft PO',
        detail:
          'Choose the winner and record a mandatory justification when the selected response is not the lowest. Awarding revokes new technical downloads for losing invitees, preserves access for the winner, and creates a Draft Purchase Order from the accepted quote.',
        gate: true,
      },
    ],
  },
  {
    codes: ['CUSTOMER_COMPLAINT'],
    title: 'Customer Complaints — Registration to COPQ',
    summary:
      'Control a customer complaint from first report and containment through investigation, corrective action, closure and failure-cost reporting.',
    participants:
      'Quality employees, QMS Head, complaint owners, CAPA action owners, Sales and the customer',
    steps: [
      {
        key: 'register',
        label: 'Register the complaint',
        detail:
          'Open Customer Complaints and record the customer, severity, owner, reported date, target date, title and a factual description. Link the Order and Product whenever they are known, and capture the immediate action already taken. Good source data is essential because these links drive traceability and later COPQ reporting.',
        href: '/qms/complaints',
      },
      {
        key: 'linked-ncr',
        label: 'Use the linked NCR',
        detail:
          'Submitting the complaint automatically creates and links a Customer Complaint NCR. Do not create a duplicate NCR for the same failure. If an immediate action was recorded, the NCR starts contained; otherwise it remains open until containment is documented. The complaint tracks the customer response while the NCR tracks the quality failure and corrective work.',
        href: '/qms/ncrs',
      },
      {
        key: 'contain',
        label: 'Contain the impact',
        detail:
          'Protect the customer and stop further escape before investigating the deeper cause. Record the containment action on the linked NCR, such as isolating stock, stopping dispatch, arranging replacement or informing the affected team. Containment limits the immediate impact but does not replace root-cause analysis or corrective action.',
      },
      {
        key: 'investigate',
        label: 'Investigate & respond',
        detail:
          'On the complaint, document the investigation or root-cause conclusion and the response given to the customer. Submitting the investigation moves the complaint to Pending Closure. Keep evidence and technical corrective work on the linked NCR/CAPA so the customer-facing record and the internal quality record remain connected without duplicating information.',
        href: '/qms/complaints',
      },
      {
        key: 'disposition-copq',
        label: 'Disposition & COPQ',
        detail:
          'The QMS Head selects the NCR disposition. Scrap can calculate failure cost from affected quantity multiplied by the Item cost when all required cost data is available; Rework, Repair, Return to Supplier, Use-as-is and Concession remain manual because the system does not know their true labour, recovery or handling cost. Review the source label and enter or override the actual amount when needed rather than treating an unknown cost as zero.',
        gate: true,
        href: '/qms/ncrs',
      },
      {
        key: 'capa',
        label: 'Complete CAPA',
        detail:
          'When corrective action is required, create a CAPA from the linked NCR, record the root cause, correction and effectiveness criteria, and assign actions with owners and due dates. Action owners complete their work with notes or evidence, and the QMS Head verifies each action. This provides proof that the cause was addressed, not merely that the customer received a reply.',
        href: '/qms/capas',
      },
      {
        key: 'effectiveness',
        label: 'Verify effectiveness',
        detail:
          'After every CAPA action is verified, submit the effectiveness result for QMS Head review. An effective result closes the CAPA and its linked NCR; an ineffective result must not be treated as closure and needs further corrective work. This is the formal quality gate that confirms recurrence risk has actually been controlled.',
        gate: true,
        href: '/qms/capas',
      },
      {
        key: 'close-complaint',
        label: 'Close the complaint',
        detail:
          'The QMS Head reviews the investigation, the response to the customer and the closure note before closing the complaint. Complaint closure and NCR/CAPA closure are separate records: the first confirms the customer case was handled, while the second confirms the internal corrective process was effective. Check both so no open quality obligation is hidden by closing only one side.',
        gate: true,
        href: '/qms/complaints',
      },
      {
        key: 'analytics',
        label: 'Complete the COPQ roll-up',
        detail:
          'Open QMS Analytics, select the reporting date range and review Failure Cost totals. The report separates system-calculated, manually entered and unvalued NCRs, with breakdowns by disposition, Product, Order and Vendor or Supplier. Resolve unvalued records where reliable cost is available; this view reports failure costs only and does not yet include appraisal, warranty or broader prevention costs.',
        href: '/qms/analytics',
      },
    ],
  },
  {
    codes: ['RESOURCE_PLAN'],
    title: 'Resource Planning — Kickoff to Negotiated Cost',
    summary:
      'Turn a completed project’s BOMs into a costed material plan, then negotiate and track savings against benchmark cost.',
    participants:
      'SCM employees, SCM Managers, Project Managers and SUPER_ADMIN',
    steps: [
      {
        key: 'eligible',
        label: 'Eligible project',
        detail:
          'Only a completed project kickoff is eligible for a resource plan — its scope and order lines are settled. The plan is built per project, tying material cost back to a specific order. Draft or in-flight kickoffs are not offered.',
        href: '/scm/resource-plans',
      },
      {
        key: 'generate',
        label: 'Generate plan',
        detail:
          'An SCM Manager (or SUPER_ADMIN) generates the plan, exploding every released BOM on the order down to leaf materials and aggregating gross quantities with wastage folded in. Regenerating refreshes quantities and benchmark cost while preserving any prices already negotiated. This gate keeps plan creation with accountable SCM leadership.',
        gate: true,
      },
      {
        key: 'benchmark',
        label: 'Benchmark snapshot',
        detail:
          'Each required item’s current standard cost is snapshotted as the benchmark — the baseline the negotiation is measured against. It comes from the Item Master’s costing, so an item costed late still resyncs on the next regenerate. The benchmark is what "good" looks like before negotiation.',
      },
      {
        key: 'negotiate',
        label: 'Negotiated prices',
        detail:
          'SCM enters the price actually negotiated per unit for each material, with optional notes on the deal. These entries are the team’s real work and are never overwritten by a regenerate. Unpriced lines simply fall back to the benchmark in the totals.',
      },
      {
        key: 'variance',
        label: 'Variance analysis',
        detail:
          'Line and plan totals plus variance are computed on read from the stored per-unit values, so the numbers can never drift. A positive variance flags a cost increase; a negative one is a saving. This is where the value of sourcing effort becomes visible.',
      },
      {
        key: 'rollup',
        label: 'Cross-project summary',
        detail:
          'A cross-project view rolls up benchmark versus negotiated cost across every plan. It shows where savings are concentrated and where costs are running hot. Managers use it to steer sourcing priorities.',
      },
    ],
  },
  {
    codes: ['RECRUITMENT'],
    title: 'Recruitment — Requisition to Candidate Selection',
    summary:
      'Raise and approve one position, then let HR track the search through to a confirmed candidate.',
    participants: 'Hiring Managers, vertical owners, HR and SUPER_ADMIN',
    steps: [
      {
        key: 'raise',
        label: 'Open Candidate Requisitions',
        detail:
          'Go to HR > Candidate Requisitions. Managers and above can raise a request for their own vertical; the vertical is taken from their employee record and cannot be changed. Before starting, confirm that the correct vertical owner is assigned in Administration > Verticals, because that owner is the first approver.',
        href: '/hr/candidate-requisitions',
      },
      {
        key: 'budget',
        label: 'Complete the hiring request',
        detail:
          'Under Request a position, enter the position title, employment type, optional target joining date, annual CTC budget, business justification, Key Responsibilities and KPIs. The CTC must be greater than zero. Responsibilities and KPIs become the approved role expectations and later pre-fill the Offer Letter, so make them specific and measurable.',
      },
      {
        key: 'vertical',
        label: 'Submit to the vertical owner',
        detail:
          'Select Submit requisition. The system creates a unique REQ number and sends it to the owner of the requester’s vertical with status Pending Vertical Approval. The owner approves it to continue, or rejects it with a mandatory reason; rejection ends this request. If no vertical owner is configured, the request routes directly to the CEO instead of becoming stuck.',
        gate: true,
      },
      {
        key: 'superadmin',
        label: 'CEO gives final approval',
        detail:
          'Only after the vertical owner approves does the request enter the CEO/SuperAdmin queue with status Pending SuperAdmin Approval. The CEO reviews the same position, budget and justification, then approves or rejects it. A rejection requires a reason and is terminal, so a corrected need must be raised as a new requisition.',
        gate: true,
      },
      {
        key: 'recruit',
        label: 'HR runs recruitment',
        detail:
          'After final approval, only HR sets the hiring stage, and only the two stages that are actually decisions: Job Posted and Interviewing. The requester, vertical owner and CEO can see the current stage but cannot change it. The later stages are consequences, not choices — sending the approved Offer Letter moves the position to Offer Extended — so HR never maintains two disconnected trackers.',
        href: '/hr/candidate-requisitions',
      },
      {
        key: 'selected',
        label: 'Select an applicant',
        detail:
          'HR marks one applicant Selected on their application. That authorises an Offer Letter for them and reserves the position for one live offer, but it is not the hire: the requisition only becomes Candidate Selected — shown as Fulfilled — when that candidate accepts and is onboarded. If they decline, the position returns to Interviewing and another applicant can be selected against the same approval.',
        href: '/hr/candidate-requisitions',
      },
    ],
  },
  {
    codes: ['OFFER_LETTER'],
    title: 'Offer Letters — Draft to Accepted',
    summary:
      'Author a selected candidate’s offer with a computed CTC, freeze it for approval, send it and record their answer.',
    participants: 'HR employees, vertical owners and the candidate',
    steps: [
      {
        key: 'draft',
        label: 'Draft offer',
        detail:
          'HR picks an applicant marked Selected after their interview — there is no employee record yet, and there should not be: the offer comes first. The requisition’s approved Key Responsibilities and KPIs pre-fill the editor and remain editable. One requisition carries one live offer at a time, and drafting the letter claims it.',
        href: '/hr/offer-letters',
      },
      {
        key: 'ctc',
        label: 'CTC & terms',
        detail:
          'HR enters what is actually being offered: position, employment type, joining date, place of posting and monthly CTC. Annexure A is computed from that CTC by the same calculator onboarding uses, so the letter and the employee’s first salary structure cannot disagree. HR previews the exact document the candidate will see.',
      },
      {
        key: 'submit',
        label: 'Submit for approval',
        detail:
          'On submit, the rendered document is frozen into a verbatim snapshot and routed to the vertical owner. Freezing guarantees the approver signs off exactly what will be issued. Any later edit invalidates the approval and drops the letter back to draft.',
      },
      {
        key: 'approve',
        label: 'Vertical owner approves',
        detail:
          'The owner of the position’s vertical reviews and approves the frozen offer, then the CEO signs off; a rejection returns it to HR with feedback. If that vertical has no owner, the CEO is the fallback approver. This gate ensures an accountable sign-off before anything reaches the candidate and records who signed and when.',
        gate: true,
      },
      {
        key: 'issued',
        label: 'Sent to the candidate',
        detail:
          'HR downloads the approved letter, sends it, and records it as sent — which moves the position to Offer Extended. Because the document is a frozen snapshot, what the candidate holds can never silently drift from what was approved; editing the letter after it has gone out withdraws it and requires a fresh approval.',
      },
      {
        key: 'answer',
        label: 'Accepted or declined',
        detail:
          'The candidate’s answer is recorded against the letter, separately from our own approval. An acceptance locks the terms, closes the position’s application links and is the single thing that authorises onboarding. A decline is recorded with its reason and returns the position to Interviewing, so another applicant can be selected without re-raising the requisition.',
        gate: true,
      },
    ],
  },
  {
    codes: ['KICKOFF'],
    title: 'Project Kickoff — Order to Execution Plan',
    summary:
      'Stand up a released order as a running project: agree scope, plan milestones and confirm material readiness.',
    participants: 'Project Managers, Sales, SCM, Production and stakeholders',
    steps: [
      {
        key: 'released',
        label: 'Order handed over',
        detail:
          'A confirmed, released sales order is handed from Sales into delivery. It carries the agreed scope, line items and customer commitments. This is the trigger to convene a kickoff.',
        href: '/project-kickoff',
      },
      {
        key: 'created',
        label: 'Kickoff created',
        detail:
          'A project kickoff is created against the order to coordinate execution. It becomes the hub for scope, people and planning. Everything about running the project hangs off this record.',
      },
      {
        key: 'attendees',
        label: 'Attendees & scope',
        detail:
          'Stakeholders and attendees are added and the scope is confirmed with the team. Getting the right people in early surfaces risks and dependencies. Shared understanding here prevents rework later.',
      },
      {
        key: 'milestones',
        label: 'Milestones & action items',
        detail:
          'Milestones and action items are planned, often from a reusable milestone template, and assigned to owners. The project’s stage is derived from this real state, not a stored flag. Progress is tracked against the plan.',
      },
      {
        key: 'stock',
        label: 'Material readiness',
        detail:
          'The kickoff explodes the order’s released BOMs into a stock report, showing what is on hand versus short. Shortfalls become the material need that seeds SCM sourcing. This is where planning meets the supply chain.',
      },
      {
        key: 'completed',
        label: 'Kickoff completed',
        detail:
          'Completing the kickoff marks the project as ready to run and unlocks downstream steps such as resource planning. Completion is derived from actual milestone state. The project now executes against its plan.',
      },
    ],
  },
  {
    codes: ['PLM'],
    title: 'Product Lifecycle — Design to Dispatch',
    summary:
      'Track a product line from design through review, release, production and QC to dispatch on a single lifecycle board.',
    participants: 'Design, R&D, SCM, Production, Quality and vendors',
    steps: [
      {
        key: 'design',
        label: 'Design',
        detail:
          'The product line starts in design, where the concept and drawings take shape. This is the first tracked stage of its lifecycle. Everything downstream builds on decisions made here.',
        href: '/plm/trackers',
      },
      {
        key: 'review',
        label: 'Design review',
        detail:
          'The design is submitted for review and either approved or rejected back for changes. This gate ensures the design is sound before drawings are released. A rejection loops back with feedback rather than proceeding.',
        gate: true,
      },
      {
        key: 'drawing',
        label: 'Drawing release',
        detail:
          'Approved drawings are released as the controlled reference for the build. Releasing locks the design intent for everyone downstream. It is the formal boundary between engineering and execution.',
      },
      {
        key: 'scm',
        label: 'Release to SCM',
        detail:
          'The product is handed to SCM so materials can be sourced against the released design. This kicks off procurement in parallel with planning. Vendors may be invited to participate in the build.',
      },
      {
        key: 'planning',
        label: 'Material planning',
        detail:
          'Material requirements are planned and readiness is tracked before production starts. Shortfalls are flagged so they can be sourced in time. Planning here keeps the production stage from stalling.',
      },
      {
        key: 'production',
        label: 'Production',
        detail:
          'The product moves into production, with progress reported against the lifecycle stage. Updates can come from internal teams or from vendors self-reporting. The board shows exactly where the build stands.',
      },
      {
        key: 'qc',
        label: 'QC',
        detail:
          'Quality checks the produced output before it can move to dispatch. This gate keeps defective product from shipping. Only cleared work advances.',
        gate: true,
      },
      {
        key: 'dispatch',
        label: 'Dispatch',
        detail:
          'Cleared product is dispatched to the customer. This is the physical handover into logistics. The lifecycle is nearly closed.',
      },
      {
        key: 'completed',
        label: 'Completed',
        detail:
          'The lifecycle is marked complete once the product has shipped and its stages are closed. The tracker becomes a record of how the product line moved end to end. It is the definitive history for that line.',
      },
    ],
  },
  {
    codes: ['PROVISIONING'],
    title: 'Provisioning — Request to Fulfilment',
    summary:
      'Request the assets and access a new or existing employee needs, approve it, and fulfil it through SCM.',
    participants: 'HR, vertical owners, SUPER_ADMIN and SCM',
    steps: [
      {
        key: 'request',
        label: 'Requests created',
        detail:
          'When the new employee’s system access is activated, the application creates one request for every active provisioning item type. The default set covers Laptop, Email ID Creation, ID Card, Business Card and Joining Kit. HR can see the complete checklist on the employee record rather than raising each standard item manually.',
        href: '/hr/provisioning-approvals',
      },
      {
        key: 'approve',
        label: 'Approval',
        detail:
          'Each request goes to its configured authority: SuperAdmin or the owner of the configured vertical. A rejection requires a reason. Approved digital actions such as Email ID Creation complete directly with the approver, while physical items continue to SCM instead of taking an unnecessary fulfilment step for every request.',
        gate: true,
      },
      {
        key: 'scm',
        label: 'Sent to SCM',
        detail:
          'Only approved physical requests are routed to SCM to source or allocate what was asked for. Ownership passes from the approver to the fulfilling team, and SCM marks the item Fulfilled once it is actually provided. This workflow records delivery without making an inventory deduction.',
        href: '/scm/provisioning',
      },
      {
        key: 'fulfilled',
        label: 'Fulfilled',
        detail:
          'SCM fulfils the request by providing the assets or arranging the access. Fulfilment is recorded against the original request for traceability. The employee now has what they need to work.',
      },
      {
        key: 'checklist',
        label: 'Checklist monitored',
        detail:
          'HR reviews the Provisioning Checklist on the employee record to see pending approvals, rejections, completed digital actions and fulfilled physical items together. The records show what was approved, who acted and when, closing the loop on joining readiness.',
      },
    ],
  },
  {
    codes: ['LOGISTICS'],
    title: 'Logistics — Dispatch to Delivery',
    summary:
      'Move finished goods to the customer with a delivery challan, track transit and confirm proof of on-time delivery.',
    participants: 'Logistics, Production, Stores, Finance and the customer',
    steps: [
      {
        key: 'draft',
        label: 'Delivery challan drafted',
        detail:
          'A delivery challan is drafted for the goods leaving the site, with its own DC number. It captures what is being shipped against which order. This is the shipping document that governs the movement.',
        href: '/logistics/dispatch',
      },
      {
        key: 'dispatched',
        label: 'Dispatched',
        detail:
          'On dispatch the goods physically leave, stock is reduced, and a draft sales invoice is seeded for Finance. One action keeps the physical, stock and billing records in step. The shipment is now on its way.',
      },
      {
        key: 'transit',
        label: 'In transit',
        detail:
          'The shipment is tracked while in transit to the customer. Its status is visible so delays can be spotted early. This is the window between leaving and arriving.',
      },
      {
        key: 'delivered',
        label: 'Delivered',
        detail:
          'The goods arrive and the challan is marked delivered. Delivery is the point the customer takes the order. It sets up the final confirmation step.',
      },
      {
        key: 'pod',
        label: 'Proof of delivery',
        detail:
          'A proof-of-delivery document is uploaded and confirmed, closing the shipment with evidence. This gate turns a claimed delivery into a verified one, reusing the same secure upload guardrails as the document vault. It protects both sides if a delivery is ever disputed.',
        gate: true,
      },
      {
        key: 'otd',
        label: 'On-time delivery',
        detail:
          'Delivery performance is measured as On-Time Delivery against the committed date. The OTD view highlights where the company is meeting or missing promises. It feeds continuous improvement in logistics.',
        href: '/logistics/otd',
      },
    ],
  },
];

/** Pick the flow overview for a vertical code (null if none / no vertical). */
export function flowForVertical(
  code: string | null | undefined,
): VerticalFlow | null {
  if (!code) return null;
  return VERTICAL_FLOWS.find((f) => f.codes.includes(code)) ?? null;
}
