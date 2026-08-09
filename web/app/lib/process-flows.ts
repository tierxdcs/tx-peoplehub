/**
 * Static, hardcoded end-to-end process overviews (spec §6). These change rarely,
 * so they live here as a plain data array — a one-file edit to update, no admin
 * machinery. Each step has a short label, a few lines of detail, and a `gate`
 * flag marking approval / QC / sign-off points (where people get blocked and
 * most need to understand why).
 *
 * The first seven entries are the per-vertical flows (their `codes` match
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
    codes: ['RND', 'DESIGN'],
    title: 'R&D / Design — BOM to Release',
    summary:
      'Define what must be built, review its technical structure and release a controlled BOM for execution.',
    participants: 'R&D and Design employees, R&D Head, Production and SCM',
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
          'A material need is identified — usually from a kickoff stock shortfall, or raised manually by a project. It states which item is short and how much. This is the seed for a sourcing exercise.',
      },
      {
        key: 'rfq',
        label: 'RFQ',
        detail:
          'A Request for Quotation is floated to three or more qualified suppliers or vendors to keep sourcing competitive. It lists the items, quantities and the response deadline. Inviting several suppliers is a policy safeguard against single-source bias.',
        href: '/scm/rfqs',
      },
      {
        key: 'quotes',
        label: 'Sealed quotes',
        detail:
          'Suppliers submit sealed quotes that stay hidden from everyone until the RFQ closes. This prevents early bids from being leaked or shopped around. It keeps the comparison fair for every invitee.',
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
          'The buyer awards the RFQ to a supplier; if it is not the lowest quote, a written justification is required. This gate keeps non-lowest awards transparent and auditable. The award then pre-fills the purchase order.',
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
    title: 'HR — Onboarding to Payroll',
    summary:
      'Bring a new employee into the company, enable their work and support their ongoing people operations.',
    participants:
      'HR employees, hiring Managers, vertical owners, SuperAdmin and the employee',
    steps: [
      {
        key: 'onboard',
        label: 'Onboarding',
        detail:
          'A new employee’s personnel record is created with their role, vertical and joining details. This is the master record everything else hangs off. Good data here drives payroll, access and reporting.',
        href: '/hr/onboard',
      },
      {
        key: 'access',
        label: 'Access granted',
        detail:
          'A login and role are assigned, and system access is provisioned — often needing a SuperAdmin or vertical owner to approve. This gate controls who can see and do what. Access is granted deliberately, not by default.',
        gate: true,
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
    codes: ['RESOURCE_PLAN'],
    title: 'Resource Planning — Kickoff to Negotiated Cost',
    summary:
      'Turn a completed project’s BOMs into a costed material plan, then negotiate and track savings against benchmark cost.',
    participants: 'SCM employees, SCM Managers, Project Managers and SUPER_ADMIN',
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
    title: 'Recruitment — Requisition to Approval',
    summary:
      'Raise a headcount requisition and route it through vertical and executive approval before hiring begins.',
    participants: 'Hiring Managers, vertical owners, HR and SUPER_ADMIN',
    steps: [
      {
        key: 'raise',
        label: 'Requisition raised',
        detail:
          'A hiring manager raises a candidate requisition for a role, which is stamped with a unique REQ number. It names the position, employment type and target joining date. This is the formal request to add headcount.',
        href: '/hr/candidate-requisitions',
      },
      {
        key: 'budget',
        label: 'Budget & justification',
        detail:
          'The requisition carries a budgeted annual CTC and a written justification for the hire. This makes the cost and the business case explicit up front. Approvers decide on real numbers, not vague intent.',
      },
      {
        key: 'vertical',
        label: 'Vertical owner approves',
        detail:
          'The vertical owner is the first approver, confirming the role fits the team’s plan and budget. This gate keeps hiring decisions with the accountable owner. A rejection stops the requisition with the reason recorded.',
        gate: true,
      },
      {
        key: 'superadmin',
        label: 'SuperAdmin approves',
        detail:
          'After the vertical, SUPER_ADMIN gives the final executive approval. This second gate is the company-level control on headcount growth. Only a requisition cleared at both levels can proceed to hire.',
        gate: true,
      },
      {
        key: 'approved',
        label: 'Approved to hire',
        detail:
          'A fully approved requisition authorises recruitment for the role. It feeds naturally into offer letters and, once accepted, onboarding. The paper trail from headcount request to new joiner stays intact.',
      },
    ],
  },
  {
    codes: ['OFFER_LETTER'],
    title: 'Offer Letters — Draft to Issue',
    summary:
      'Author a candidate’s offer with a computed CTC, freeze it for approval and issue the approved letter.',
    participants: 'HR employees, vertical owners and the candidate',
    steps: [
      {
        key: 'draft',
        label: 'Draft offer',
        detail:
          'HR drafts an offer letter for a candidate, choosing the role, salary structure and terms. While in draft the document renders live, recomputing as HR edits it. Nothing is committed yet.',
        href: '/hr/offer-letters',
      },
      {
        key: 'ctc',
        label: 'CTC & terms',
        detail:
          'The cost-to-company is computed from the salary structure so the numbers are consistent and correct. HR previews the exact document the candidate will see. Getting the terms right here avoids re-issuing later.',
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
          'The vertical owner reviews and approves the frozen offer, or rejects it back to HR with feedback. This gate ensures an accountable sign-off before anything reaches the candidate. Approval stamps who signed and when.',
        gate: true,
      },
      {
        key: 'issued',
        label: 'Issued to candidate',
        detail:
          'The approved, frozen letter is the official offer extended to the candidate. Because it is a snapshot, the served document can never silently drift from what was approved. Acceptance leads into onboarding.',
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
        label: 'Request raised',
        detail:
          'A provisioning request is raised for the assets and access an employee needs — hardware, tools or system access. It names what is required and for whom. This is the formal ask that starts the chain.',
        href: '/hr/provisioning-approvals',
      },
      {
        key: 'approve',
        label: 'Approval',
        detail:
          'The request is approved by the accountable authority — a vertical owner or SUPER_ADMIN, depending on the approver type. This gate controls cost and access before anything is committed. A rejection stops the request with the reason recorded.',
        gate: true,
      },
      {
        key: 'scm',
        label: 'Sent to SCM',
        detail:
          'An approved request is routed to SCM to source or allocate what was asked for. Ownership passes from the approver to the fulfilling team. The request is now a procurement/allocation task.',
        href: '/scm/provisioning',
      },
      {
        key: 'fulfilled',
        label: 'Fulfilled',
        detail:
          'SCM fulfils the request by providing the assets or arranging the access. Fulfilment is recorded against the original request for traceability. The employee now has what they need to work.',
      },
      {
        key: 'completed',
        label: 'Completed',
        detail:
          'The request is closed once everything requested has been delivered and confirmed. The record stands as proof of what was provisioned and when. This ties assets and access back to an approved decision.',
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
