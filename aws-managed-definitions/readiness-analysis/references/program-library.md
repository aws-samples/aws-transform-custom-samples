# AWS Program & GTM Library

> **Purpose:** This reference is loaded by the Portfolio Agentic Readiness (portfolio-ara) and Portfolio Modernization Readiness (portfolio-mod) Task Definitions during their program-recommendation step. The analysis agent uses it to recommend relevant AWS programs and GTM motions in the "Next Steps / Recommended Programs" section of the generated portfolio report, based on the actual findings already produced.
>
> **Scope:** Program recommendations are an engagement-level decision and are produced ONLY by the two portfolio TDs — never by the per-repo ARA or MOD TDs. The portfolio view has the cross-repo and customer-segment context required to qualify these programs.
>
> **Source:** APN Programs Roadmap (Apr 2026) + AWS Highspot (Jun 2026). Compiled by Kevin Shin, 2026-06-03. Programs indexed: 88 — Tier 1 detailed: 35 (32 from the source library + 3 ARA agentic anchor programs); Tier 2 compact index: 53.

---

## How the Agent Uses This File

After the portfolio analysis has produced its findings (cross-cutting BLOCKERs/RISKs and readiness profiles for ARA; aggregated pathways, severity counts, and classification tiers for MOD), evaluate which programs are relevant and emit a short recommendation list. Follow these rules exactly:

1. **Recommend only when qualification criteria are met.** Each program lists signal patterns, "DO NOT recommend when" exclusions, and qualification criteria. A program is eligible only when its signal patterns match the findings AND none of its exclusions apply.
2. **Cap at 3–5 recommendations per report.** Never exceed 5. Fewer is better than overwhelming the seller.
3. **Prioritize in this order:**
   1. Direct finding match (the strongest signal pattern matches an actual finding)
   2. Customer segment fit (Enterprise / SMB / ISV / Startup / WWPS — inferred from portfolio `context` and `service_inventory`)
   3. Entry-point programs (no prerequisites) before follow-on programs (with prerequisites)
4. **Group recommendations under three headings, in this order:** `Funded Programs` → `Engagement Models` → `GTM Motions`. (Partner/ISV, Startup, Training, and Workload-Specific programs map into the closest of these three groups — funded offers go under Funded Programs, hands-on/consulting offers under Engagement Models, sales plays and positioning under GTM Motions.)
5. **Never recommend programs marked `Retiring`** and never recommend programs marked `Launching` unless the launch is imminent (see Status Key).
6. **Sequence logically:** Assessment → Funding → Execution → Optimization. Do not recommend a follow-on program without surfacing its prerequisite.
7. **Do not expose internal scoring.** The MOD internal 1–4 maturity score is internal only. When citing MOD evidence in a recommendation, reference unified severity (`High` / `Medium` / `Low`), `severity_status` (`Ready` / `Needs Work` / `Critical`), `score_rating` (`Mature` / `Partial` / `Needs Work` / `Not Ready`), or pathway/profile names — never the numeric score.
8. **Run the reasoning checklist** (at the end of this file) before finalizing the list.

### Mapping findings to triggers — vocabulary alignment

This library is consumed by two different analyses with different finding vocabularies. When a signal pattern below references a "finding" or "dimension," interpret it against the actual emitted vocabulary:

**ARA (portfolio-agentic-readiness):**
- ARA emits findings with unified severity `High` / `Medium` / `Low` and native severity `BLOCKER` / `RISK-SAFETY` / `RISK-QUALITY` / `INFO`.
- ARA readiness profiles are exactly: `Agent-Ready`, `Pilot-Ready`, `Pilot-Ready (Safety Concerns)`, `Remediation Required`, `Not Agent-Integrable`.
- ARA category (dimension) display names are exactly: `API Surface`, `Authentication & Authorization`, `State Management`, `Human-in-the-Loop`, `Data Accessibility`, `Discovery & Documentation`, `Observability`, `Engineering Maturity`.
- "3+ High-severity findings across any dimension" → count unified `High` findings (BLOCKERs + conditional BLOCKERs resolved as High) across the portfolio / a service.
- A dimension "showing problems" → that category has 2+ `Medium`/`High` findings. ARA has no "Blocked"/"Needs Work" labels (those are MOD-only); translate accordingly.

**MOD (portfolio-modernization-readiness):**
- MOD emits findings with unified severity `High` / `Medium` / `Low`; per-category `severity_status` is `Ready` / `Needs Work` / `Critical`; `score_rating` is `Mature` / `Partial` / `Needs Work` / `Not Ready`.
- MOD pathway names are exactly: `Move to Cloud Native`, `Move to Containers`, `Move to Open Source`, `Move to Managed Databases`, `Move to Managed Analytics`, `Move to Modern DevOps`, `Move to AI`.
- MOD finding `effort` field is `High` / `Medium` / `Low` — use it for "High Effort" signal patterns.
- **On-prem / VMware / data-center triggers:** MOD analyzes workloads already targeting AWS and explicitly excludes on-prem from scope. Programs whose signal is "on-prem workloads" (OLA, Migration Evaluator, VMCCO, MAP) must trigger from portfolio/service `context` references (e.g., "running on EC2 from a legacy data center", "VMware estate", "migrating from on-prem") or from IaC evidence of non-AWS/VMware providers (`vsphere_*`, bare-metal configs) — NOT from MOD findings about workloads that already run on AWS.

`[ARA]`, `[MOD]`, or `[ARA+MOD]` tags on each program indicate which analysis the program is most relevant to. A program may be surfaced by either portfolio TD when tagged for both. Programs tagged `[ARA-anchor]` are agentic enablement programs surfaced only by the portfolio ARA TD.

---

## AGENTIC ENABLEMENT PROGRAMS (ARA Anchors)

> These three programs are surfaced **only by the portfolio ARA TD**. They are agentic-readiness-specific and have no MOD equivalent. They group under **Engagement Models** in the rendered output. When multiple are triggered, sequence them: AI DLC → AXE → Innovation EBA (Innovation EBA may run in parallel with AXE when use cases are independent).

### AI DLC (AI Driven Development Lifecycle) `[ARA-anchor]`
- **Description:** Workshop for adopting the AI Driven Development Lifecycle, emphasizing two dimensions: (1) AI Powered Execution with Human Oversight — AI creates detailed work plans, seeks clarification, and defers critical decisions to humans who possess contextual understanding and business knowledge; (2) Dynamic Team Collaboration — as AI handles routine tasks, teams unite in collaborative spaces for real-time problem solving, creative thinking, and rapid decision-making, shifting from isolated work to high-energy teamwork that accelerates innovation and delivery.
- **Signal patterns:** Portfolio shows teams without established AI-assisted development practices, or engineering-maturity findings indicate manual development workflows that could benefit from AI-driven automation.
- **How to evaluate:** Check `Engineering Maturity` (ENG) findings across the portfolio. If 50%+ of services have a `Medium`+ finding on ENG-Q1 (Infra Governance), ENG-Q2 (CI/CD + Contracts), or ENG-Q3 (Rollback), recommend AI DLC. Also recommend if the portfolio `context` mentions a desire for AI-assisted development practices.
- **Delivers:** Adoption of AI-driven development practices and team collaboration model.
- **Segment:** All.
- **Sequencing:** Run first — establishes AI-driven development practices before agentic work.
- **Pairs with:** AXE, Innovation EBA.

### AXE (Agent Experience Engagement) `[ARA-anchor]`
- **Description:** A strategic methodology that helps enterprises implement agentic AI solutions by starting with desired customer and employee experience and working backwards to define AI agents and technical architecture. Built on the proven D2E methodology with 580+ successful engagements, AXE delivers a six-phase framework covering business process mapping, task identification, evaluation metrics, data architecture, governance, and guardrails. The Guardrails & Boundaries phase aligns with ARA, which evaluates whether target systems have the technical controls needed to safely support autonomous agents. Together they provide a complete assess-to-implement pathway: ARA validates system readiness while AXE designs the agent experience and implementation roadmap.
- **Signal patterns:** Portfolio shows 3+ services in `Pilot-Ready` or `Agent-Ready` state, or business has defined customer/employee experience goals but lacks a technical implementation roadmap.
- **How to evaluate:** Count services with profile `Agent-Ready` or `Pilot-Ready`. If count >= 3, recommend AXE. Also recommend if the portfolio `context` describes experience-level goals (e.g., "customer support agent", "employee productivity") without a corresponding technical implementation plan.
- **Delivers:** Agent experience design, six-phase implementation roadmap, governance and guardrails.
- **Segment:** Enterprise.
- **Sequencing:** Run after AI DLC to design the agent experience.
- **Pairs with:** AI DLC, Innovation EBA, ACP.

### Innovation EBA (AIML-GenAI) `[ARA-anchor]`
- **Description:** A 3-day sprint-based, interactive engagement that enables customers to build AI/ML models or deliver a Generative AI use case in an accelerated fashion using AWS services and prescriptive guidance. Targets customers with higher cloud maturity who want to leverage AI/ML to solve business problems and innovate faster. Follows the 4-step EBA framework (Executive Alignment → Readiness → Accelerate → Transform At Scale) with workstreams including Foundations, Data Engineering, GenAI Build/Evaluate, UI Integration, ML Ops, and Command Center. Develops customer skills through learning-by-doing and builds/accelerates a GenAI use case pipeline based on a blueprint developed during the EBA.
- **Signal patterns:** Portfolio `context` indicates AI/ML or GenAI is a strategic imperative, executive sponsorship exists, use cases deliver critical business value, a data strategy exists, and the customer is committed to production deployment within ~90 days. The portfolio should also show a backlog of AIML-GenAI use cases and a customer team committed to upskilling.
- **How to evaluate:** Check portfolio `context` for: (1) AI/ML or GenAI as strategic priority, (2) executive sponsorship, (3) existing data and data strategy (services with established data pipelines, DynamoDB/Aurora/S3 data stores), (4) use cases in customer experience (chatbots, post-call analytics, personalization), productivity (intelligent search, summarization, code generation), business operations (IDP, fraud detection, predictive maintenance), or content creation. Also recommend if 3+ services have production-ready data stores AND the `context` describes GenAI ambitions beyond what AXE alone covers.
- **Delivers:** Accelerated GenAI/AIML use-case build with a reusable blueprint and pipeline.
- **Segment:** Enterprise (higher cloud maturity).
- **Sequencing:** Run when the customer is ready to accelerate a use case into production; may run in parallel with AXE if use cases are independent.
- **Pairs with:** AI DLC, AXE, GenAI Innovation Center.

---

## FUNDED PROGRAMS

### MAP (Migration Acceleration Program) `[ARA+MOD]`
- **Signal patterns:** 3+ High-severity findings across any dimension (ARA) or 3+ services classified `Remediation Required`/`Not Ready` (MOD); MODA shows multiple "Move to" pathways requiring significant investment; customer has migration-scale workload referenced in `context`.
- **DO NOT recommend when:** Opportunity <$500K ARR; customer only needs assessment (recommend OLA / AppMod Assessment instead); single-app modernization (recommend AppMod PoC instead); workload is already running on AWS with no net-new migration (MAP is for net-new migration to AWS).
- **Qualification:** $500K+ ARR opportunity; committed migration/modernization plan; partner engaged; workloads identified.
- **Funding:** Credits + partner cash (up to 30% ARR via SPI).
- **Delivers:** Migration/modernization support, tools, training, partner expertise.
- **Segment:** Enterprise, SMB (MAP Lite for <$500K).
- **Time to value:** 3–6 months.
- **Activation:** Create opp in AWSentral + MAP tag; engage MAP SA.
- **Prerequisite:** OLA or Migration Evaluator recommended first.
- **Pairs with:** EBA, OLA, AppMod Assessment.

### MAP for AI Modernization `[ARA+MOD]`
- **Signal patterns:** ARA profile is `Remediation Required` or `Pilot-Ready` AND customer has a modernization need to enable agentic/AI workloads; MODA `Move to AI` pathway triggered.
- **DO NOT recommend when:** Customer only needs AI assessment (recommend AI Assessment Program); no modernization needed (architecture already agent-ready, i.e., ARA `Agent-Ready`).
- **Qualification:** MAP-eligible opp + AI modernization use case per Jan 2026 eligible list.
- **Funding:** MAP credits (AI use cases).
- **Delivers:** Modernization specifically for AI readiness.
- **Segment:** Enterprise.
- **Prerequisite:** Standard MAP qualification + AI use case validation.
- **Pairs with:** AI Assessment, Agentic Catalyst Program.

### EBA (Experience-Based Acceleration) `[ARA+MOD]`
- **Signal patterns:** Multiple `High` effort remediation items in findings; customer team lacks hands-on experience with target architecture; deal stalled on technical validation. (MOD: 2+ services with a triggered pathway AND `Partial`/`Needs Work`/`Not Ready` classification.)
- **DO NOT recommend when:** Customer has strong internal engineering team; findings are mostly Low effort; customer just needs assessment not execution.
- **Qualification:** >$500K ARR; stalled deal needing technical validation; customer commits team for immersive engagement; executive sponsor.
- **Funding:** Funded engagement (varies).
- **Delivers:** Immersive hands-on migration with AWS/partner teams; real workload migration.
- **Segment:** Enterprise.
- **Time to value:** 4–8 weeks.
- **Activation:** Engage EBA team via SpecReq.
- **Prerequisite:** Opportunity identified; technical scope defined.
- **Pairs with:** MAP, AML.

### AppMod Assessment `[MOD]`
- **Signal patterns:** MODA findings across multiple pathways but customer hasn't committed to a modernization approach; customer needs a business case before funding approval.
- **DO NOT recommend when:** Customer already knows what they want to modernize (recommend AppMod PoC instead); already has MAP engagement.
- **Qualification:** Qualified+ stage opportunity; customer considering modernization but needs business case.
- **Funding:** Funded assessment (varies).
- **Delivers:** Business case, detailed migration plans, modernization execution roadmap.
- **Segment:** Enterprise, SMB.
- **Time to value:** 2–4 weeks.
- **Activation:** Engage AppMod specialist.
- **Prerequisite:** None (entry point).
- **Pairs with:** MAP, AppMod PoC Funding.

### AppMod PoC Funding `[MOD]`
- **Signal patterns:** MODA pathway triggered (`Move to Containers` or `Move to Cloud Native`) and customer wants to validate the approach on a specific application before scaling.
- **DO NOT recommend when:** Customer needs full business case first (recommend AppMod Assessment); scope is portfolio-wide (recommend MAP).
- **Qualification:** Identified modernization target (containers/serverless); technical team available; needs feasibility proof.
- **Funding:** PoC credits (varies).
- **Delivers:** Fast PoC for containers/serverless modernization.
- **Segment:** Enterprise, SMB.
- **Time to value:** 2–4 weeks.
- **Activation:** Request via AppMod specialist or scalable GTM POC mechanism.
- **Prerequisite:** None (can be entry point or post-assessment).
- **Pairs with:** AppMod Assessment, MAP.

### AppMod Partner Accelerator `[MOD]`
- **Signal patterns:** Same as AppMod PoC + a partner is driving the engagement; partner has AppMod competency.
- **DO NOT recommend when:** No partner involved; customer wants AWS-direct engagement.
- **Qualification:** Partner-driven; customer + partner aligned on AppMod scope.
- **Funding:** $100K co-funding.
- **Segment:** Enterprise.
- **Prerequisite:** Partner engaged with AppMod competency.
- **Pairs with:** MAP, ISV Accelerate.

### AI Assessment Program `[ARA]`
- **Signal patterns:** ARA profile is `Pilot-Ready` or `Agent-Ready` AND customer wants to define an AI/agentic strategy but hasn't started; customer asks "what should we do with AI?"
- **DO NOT recommend when:** Customer already has AI strategy (recommend Agentic Catalyst instead); findings are all about modernization not AI (recommend AppMod Assessment).
- **Qualification:** Seller-led pre-sales; customer exploring AI/GenAI/Agentic but needs strategy + ROI modeling.
- **Funding:** $15K (SMB) / $30K (Enterprise).
- **Delivers:** AI strategy assessment, use case discovery, ROI modeling.
- **Segment:** Enterprise ($30K), SMB ($15K).
- **Time to value:** 2–3 weeks.
- **Activation:** Seller-led; submit through assessment process.
- **Prerequisite:** None (entry point).
- **Pairs with:** Agentic Catalyst, GenAI Innovation Center.

### OLA (Optimization & Licensing Assessment) `[MOD]`
- **Signal patterns:** Portfolio/service `context` indicates on-prem workloads needing migration; customer hasn't quantified savings; VMware or Microsoft licensing referenced in `context` or IaC. (Trigger from context/IaC, not from MOD findings about already-on-AWS workloads.)
- **DO NOT recommend when:** Customer already has business case data; workloads already on AWS with no licensing concern.
- **Qualification:** Customer has on-prem workloads; willing to share infrastructure data.
- **Funding:** No cost to customer (AWS pays partner).
- **Delivers:** On-prem compute/storage/licensing analysis + AWS migration modeling (avg 36% compute savings, 45% licensing cost reduction).
- **Segment:** Enterprise, SMB.
- **Time to value:** 2–3 weeks.
- **Activation:** Submit through Assessment Central.
- **Prerequisite:** None (entry point, often first step before MAP).
- **Pairs with:** MAP, Migration Evaluator, VMCCO.

### AMA (AWS Modernization Assurance) `[MOD]`
- **Signal patterns:** Large VMware estate referenced in `context`/IaC; MODA shows `Move to Containers` or infrastructure modernization needed; competitive risk (Broadcom/Azure).
- **DO NOT recommend when:** <2000 VMs; deal <$2M ARR; no competitive pressure; customer timeline >12 months.
- **Qualification:** 2,000+ VMs; deal >$2M ARR; competitive risk; migration within 12 months; executive commitment.
- **Funding:** Migration costs + up to 50% yr1 run costs + training + licensing.
- **Segment:** Enterprise (large).
- **Time to value:** 6–12 months.
- **Activation:** VMCCO team engagement; AMA funding request (Bar Raiser certified = 5-day approval).
- **Prerequisite:** OLA completed; MAP qualified.
- **Pairs with:** VMCCO, MAP, VMP.

### MDF (Market Development Funds) `[MOD]`
- **Signal patterns:** Partner-led engagement where the partner needs marketing/demand-gen support.
- **DO NOT recommend when:** No partner involved; customer-direct engagement.
- **Qualification:** Partner with relevant competency/program enrollment.
- **Funding:** GenAI $50K, Agentic AI $25K, MSP $50K, Enterprise $50K, LOB $50K, Connect $50K, Startup $30K, SMB $25K, ISVA $25K.
- **Segment:** Partner-facing (all segments via partners).
- **Prerequisite:** Partner enrolled in relevant program.
- **Pairs with:** ISV Accelerate, PGP, BOX.

### Migration Evaluator `[MOD]`
- **Signal patterns:** Early-stage conversation; customer considering migration but no data; needs a directional business case before deeper engagement. (Trigger from `context`, not from on-AWS findings.)
- **DO NOT recommend when:** Customer already has OLA data; already committed to migration.
- **Qualification:** Any customer considering migration; willing to install data collector or provide inventory.
- **Funding:** Free tool.
- **Segment:** All.
- **Time to value:** 1–2 weeks.
- **Activation:** Self-service or SA-assisted.
- **Prerequisite:** None (entry point).
- **Pairs with:** OLA, MAP.

---

## NON-FUNDED PROGRAMS

### SHIP (Security Health Improvement Program) `[ARA+MOD]`
- **Signal patterns:** ARA `Authentication & Authorization` dimension has 2+ `Medium`/`High` findings (e.g., on AUTH-Q5 hardcoded credentials, AUTH-Q6 audit logging, AUTH-Q1 machine identity); or MOD `Security Baseline` category `severity_status` is `Needs Work`/`Critical`; findings mention hardcoded credentials, no audit logging, missing identity management.
- **DO NOT recommend when:** Security findings are minor (Low severity only); customer already has strong security posture (ARA Auth dimension has no Medium/High findings).
- **Qualification:** Any AWS customer; no minimum spend; ~2hr customer commitment for discovery.
- **Funding:** Free (no cost).
- **Delivers:** Security assessment, personalized recommendations, improvement roadmap using NIST framework.
- **Segment:** All.
- **Time to value:** 2 weeks.
- **Activation:** Submit SpecReq to engage SHIP Champion.
- **Prerequisite:** None (entry point).
- **Pairs with:** MAP (if funding needed for security remediation).

### VMCCO (VMware Cloud Customer Obsession) `[MOD]`
- **Signal patterns:** `context`/IaC references VMware, vSphere, ESXi, or virtual machines; MOD shows infrastructure-level blockers; customer mentioned Broadcom licensing concerns.
- **DO NOT recommend when:** No VMware workloads; customer already committed to a non-VMware path.
- **Qualification:** Customer with VMware workloads (any size); especially post-Broadcom license changes.
- **Funding:** Free GTM motion + funded options (AMA for >$2M).
- **Delivers:** Migration pathways, decision trees, sales guidance, funding navigation.
- **Segment:** Enterprise, SMB.
- **Activation:** Engage AWS Infrastructure Migration & Modernization Specialists; tag in AWSentral.
- **Prerequisite:** None (entry point).
- **Pairs with:** OLA for VMware, MAP, AMA, VMP.

### Well-Architected Review `[ARA+MOD]`
- **Signal patterns:** ARA `Engineering Maturity` or `Observability` dimension has 2+ `Medium`+ findings; or MOD findings span multiple categories without clear prioritization.
- **DO NOT recommend when:** Customer has already done WAR recently; findings are focused on one specific pathway (recommend the pathway-specific program instead).
- **Qualification:** Any AWS customer with workloads in production.
- **Funding:** Free.
- **Delivers:** Architecture review against 6 pillars; prioritized improvement recommendations.
- **Segment:** All.
- **Time to value:** 1–2 weeks.
- **Activation:** Partner-led or SA-led.
- **Prerequisite:** None.
- **Pairs with:** AppMod Assessment, MAP.

### AWS Transform Custom `[ARA+MOD]`
- **Signal patterns:** Any finding (this IS the tool generating findings); recommend for additional repositories not yet analyzed.
- **DO NOT recommend when:** Customer has already run ARA/MODA on all relevant repos.
- **Qualification:** Customer with code repos to analyze; self-service or SA-led.
- **Funding:** Free (self-service).
- **Delivers:** AI-powered code analysis, modernization recommendations, agentic readiness scoring.
- **Segment:** All.
- **Activation:** Self-service via AWS Transform Custom console.
- **Prerequisite:** None.
- **Pairs with:** AppMod Assessment, ARA/MODA (expand scope).

---

## PROSERVE & ENGAGEMENT MODELS

### Agentic Catalyst Program (ACP) `[ARA]`
- **Signal patterns:** ARA profile is `Pilot-Ready` or `Agent-Ready` and customer is an ISV wanting to build agentic products; customer in ideation stage.
- **DO NOT recommend when:** Customer is not an ISV; customer needs modernization before AI (recommend MAP/AppMod first); customer already has agentic products in production.
- **Qualification:** ISV customer; in ideation stage; C-suite commitment; willing to dedicate exec + tech team for 1 week.
- **Funding:** Free (week-long engagement).
- **Delivers:** Executive alignment, technical build days, curated use cases, solution architecture, ROI preview.
- **Segment:** ISV only.
- **Time to value:** 1 week (engagement) + 12 months (production).
- **Activation:** Nomination by account team.
- **Prerequisite:** None (entry point for ISVs).
- **Pairs with:** ISV Booster, AI Assessment.

### Immersion Days `[ARA+MOD]`
- **Signal patterns:** Findings show `High` effort remediation in specific areas (containers, serverless, observability) and customer team lacks that specific skill; MODA pathway requires a new technology the customer hasn't used.
- **DO NOT recommend when:** Customer team already skilled in target technology; findings are strategy/funding problems not skill problems.
- **Qualification:** Technical team available for 1-day hands-on; specific service/architecture interest identified.
- **Funding:** Free (1-day workshop).
- **Delivers:** Hands-on deep-dive on specific AWS services/architectures.
- **Segment:** All.
- **Time to value:** 1 day.
- **Activation:** Request via SA or ProServe.
- **Prerequisite:** Specific skill gap identified.
- **Pairs with:** EBA, AML.

### AML (Application Modernization Lab) `[MOD]`
- **Signal patterns:** MODA `Move to Containers` or `Move to Cloud Native` + multiple `High` effort findings + customer team needs both training and guided execution (the training/execution need is inferred from `context` or surfaced in the engagement, not from code).
- **DO NOT recommend when:** Customer just needs a PoC (recommend AppMod PoC); customer has strong modernization experience; scope is assessment not execution.
- **Qualification:** Customer team available for training + guided modernization; Windows/.NET or Java workloads typical.
- **Funding:** Funded (credit incentive available via Windows Modernization Credits).
- **Delivers:** Modernization training + guided execution.
- **Segment:** Enterprise.
- **Time to value:** 4–8 weeks.
- **Activation:** Engage ProServe.
- **Prerequisite:** Modernization target identified.
- **Pairs with:** EBA, MAP, Microsoft Modernization Program.

### GenAI Innovation Center `[ARA]`
- **Signal patterns:** ARA profile is `Agent-Ready` and customer wants to co-innovate on GenAI solutions (not just integrate agents into existing apps).
- **DO NOT recommend when:** Customer needs modernization first; customer just wants agent integration (recommend ACP or AI Assessment).
- **Qualification:** Strategic account; customer building GenAI solutions; willing to co-innovate.
- **Funding:** Free (innovation program).
- **Delivers:** Comprehensive GenAI innovation + delivery program.
- **Segment:** Enterprise (strategic).
- **Activation:** SA nomination.
- **Prerequisite:** AI strategy defined; architecture agent-ready.
- **Pairs with:** AI Assessment, Agentic Catalyst.

### ProServe Residency `[ARA+MOD]`
- **Signal patterns:** ARA profile is `Remediation Required`/`Not Agent-Integrable` with 10+ High/Medium findings spanning most dimensions (or MOD `Not Ready` with broad High counts); customer needs sustained expert support over months; complexity too high for workshops.
- **DO NOT recommend when:** Findings are focused (1–2 dimensions); customer can execute with workshops + PoC; budget not available for paid engagement.
- **Qualification:** Complex transformation; customer budget for paid engagement; 3–12 month program.
- **Funding:** Paid engagement (varies).
- **Delivers:** Dedicated AWS experts working alongside customer teams.
- **Segment:** Enterprise.
- **Time to value:** 3–12 months.
- **Activation:** Engage ProServe.
- **Prerequisite:** Scope defined; budget approved.
- **Pairs with:** MAP (to fund), EBA (lighter alternative).

---

## GTM MOTIONS & SALES PLAYS

### Agentic-led Modernization Sales Play `[ARA+MOD]`
- **Signal patterns:** The ARA/MODA report itself IS the proof point; findings demonstrate legacy apps need modernization to become agent-ready; use the report as the conversation starter.
- **Qualification:** Customer interested in agent-ready architecture; ARA/MODA findings in hand.
- **Delivers:** Full-stack transformation positioning to unlock agent-ready architecture.
- **Activation:** Use ARA/MODA report as first-call evidence; reference Highspot sales play.
- **Pairs with:** MAP, AppMod Assessment, ACP.

### AWS Pathways for VMware Workloads (VMCCO) `[MOD]`
- **Signal patterns:** VMware workloads referenced in `context`/IaC; infrastructure-level findings.
- **Qualification:** Customer has VMware workloads.
- **Delivers:** Decision tree for migration pathways, objection handling, funding navigation.
- **Activation:** Reference VMCCO decision tree; engage IMM specialists.
- **Pairs with:** VMCCO, OLA for VMware, AMA.

### ModNet (Microsoft Workload Modernization) `[MOD]`
- **Signal patterns:** MODA shows Windows/.NET/IIS/SQL Server workloads; findings reference Microsoft licensing or Windows-specific tech debt.
- **Qualification:** Customer with Microsoft workloads (.NET, SQL, Windows).
- **Delivers:** AI-powered Microsoft workload modernization positioning + financial incentives.
- **Activation:** Reference ModNet on Highspot.
- **Pairs with:** Microsoft Modernization Program, AML, AWS Transform for Windows.

---

## PARTNER & ISV PROGRAMS

### ISV Accelerate (ISVA) `[ARA+MOD]`
- **Signal patterns:** Customer IS an ISV partner; ARA/MODA run on their SaaS product; they want to co-sell with AWS.
- **DO NOT recommend when:** Customer is an end-user enterprise (not an ISV).
- **Qualification:** ISV partner; listed on Marketplace or co-selling.
- **Funding:** Co-sell incentives + $25K MDF.
- **Segment:** ISV only.
- **Pairs with:** ISV Booster, ACP, SaaS Factory.

### ISV Booster Program `[ARA+MOD]`
- **Signal patterns:** ISV customer with $1M–$50M ARR; slow/negative growth; ARA/MODA shows their product needs modernization to compete.
- **Qualification:** $1M–$50M ARR ISV; negative or slow growth; nominated.
- **Funding:** ACP + Enhanced Passport + VIR (3 pillars).
- **Segment:** ISV only.
- **Pairs with:** ISV Accelerate, ACP.

### SaaS Factory `[MOD]`
- **Signal patterns:** MODA findings show multi-tenancy gaps, SaaS architecture debt; customer is an ISV building SaaS on AWS.
- **Qualification:** ISV building multi-tenant SaaS on AWS.
- **Funding:** Free technical enablement.
- **Segment:** ISV only.
- **Pairs with:** ISV Accelerate, OneSaaS.

---

## STARTUP PROGRAMS

### AWS Activate `[ARA+MOD]`
- **Signal patterns:** Customer is an early-stage startup; ARA/MODA run on their MVP/prototype; needs credits to execute modernization.
- **DO NOT recommend when:** Customer is an established enterprise.
- **Qualification:** Startup; early stage; apply via accelerators or direct.
- **Funding:** Up to $100K credits (varies by tier).
- **Segment:** Startup only.
- **Pairs with:** Global Startup Program, Kiro Startup Credits.

---

## TRAINING & ENABLEMENT

### AgentStorming Workshop `[ARA]`
- **Signal patterns:** ARA report generated but customer wants to identify WHERE to deploy agents in their business processes (beyond code readiness); customer interested in agentic transformation beyond single-repo scope.
- **DO NOT recommend when:** Customer only needs code-level remediation; not ready for process-level agentic thinking.
- **Qualification:** Customer exploring where AI agents can transform processes.
- **Funding:** Free (workshop).
- **Delivers:** Cognitive complexity analysis + EventStorming to identify agent-ready business processes.
- **Segment:** All.
- **Activation:** Engage Agentic Transformation team.
- **Pairs with:** ARA/MODA (code-level), ACP (ISVs), AI Assessment.

### AWS AI League `[ARA]`
- **Signal patterns:** ARA findings indicate team skill gaps in AI/agent development; customer wants to upskill teams before implementing agent integrations.
- **Qualification:** Customer team interested in AI upskilling; willing to run an internal tournament.
- **Funding:** Free (gamified).
- **Segment:** Enterprise.
- **Pairs with:** Immersion Days, ACP.

---

## WORKLOAD-SPECIFIC PROGRAMS

### Oracle DB@AWS Pilot Promotion `[MOD]`
- **Signal patterns:** MODA `Move to Managed Databases` pathway with Oracle-specific findings.
- **Qualification:** Oracle DB customer in NAMER; partner engaged; MAP funding eligible.
- **Funding:** MAP funding for Oracle DB migration.
- **Segment:** Enterprise (NAMER only).
- **Pairs with:** MAP, OLA for Databases.

### Kafka Migration Program `[MOD]`
- **Signal patterns:** MODA `Move to Managed Analytics` pathway with Kafka/streaming references.
- **Qualification:** Customer running Kafka on-prem or self-managed.
- **Funding:** Funded migration.
- **Segment:** Enterprise.
- **Pairs with:** MAP.

### Microsoft Modernization Program `[MOD]`
- **Signal patterns:** MODA findings reference Windows Server, .NET Framework, IIS, SQL Server; `Move to Containers` or `Move to Cloud Native` for Windows workloads.
- **Qualification:** Windows/.NET workloads; partner engaged.
- **Funding:** AWS-funded partner solutions.
- **Segment:** Enterprise.
- **Pairs with:** ModNet, AML, AWS Transform for Windows.

---

## TIER 2: COMPACT INDEX (Additional Programs)

> **Agent instruction:** Scan this index after selecting Tier 1 recommendations. If the customer's technology stack, workload type, or segment matches a Tier 2 program better than any Tier 1 option, surface the Tier 2 program instead. Format: one-liner with trigger condition. The same 3–5 cap, grouping, and status rules apply.

### Funded Programs (not in Tier 1)
| Program | Trigger Condition | Segment | Funding |
|---------|-------------------|---------|---------|
| MAP Lite | Migration opp <$500K ARR; too small for full MAP | SMB | Credits (lite package) |
| AIAF Strategic Pilot | Post-AI Assessment; high-value use case identified; ready for funded pilot | Enterprise | Funded pilot |
| OLA for Databases | On-prem Oracle/SQL Server; evaluating DB migration specifically | Enterprise, SMB | Free (AWS pays partner) |
| OLA for VMware | VMware environment; needs vCenter data analysis before migration decision | Enterprise | Free (AWS pays partner) |
| Must Win Fund (MWF) | Competitive deal at risk (Azure, GCP poaching); need credits to close | Enterprise | Up to 25% ARR |
| VMware Modernization Program (VMP) | Partner-led VMware modernization; partner has VMware competency | Enterprise | Partner funding |
| AWS Windows Modernization Incentive Credits | Customer in AML engagement for Windows workloads | Enterprise | Credit incentive |
| Data & AI Partner Funding Hub | Data or AI workload with partner engagement; need aggregated funding view | Enterprise | Various |
| Project Rubicon | Massive deal ($10M+ ARR); multi-year strategic transformation | Enterprise (largest) | Large-scale |
| SAP RISE Acceleration Program | SAP customer evaluating RISE with migration to AWS | Enterprise | AGI-funded |
| Proof of Concept (POC) - Scalable GTM | Partner or customer needs quick funded PoC validation | All | Funded PoC |
| Innovation Sandbox | Customer needs experimentation environment for new AWS capabilities | Enterprise | Sandbox funding |

### Non-Funded Programs (not in Tier 1)
| Program | Trigger Condition | Segment | Notes |
|---------|-------------------|---------|-------|
| MRA (Migration Readiness Assessment) | Early-stage; customer not committed to migration; need readiness check | All | Free; entry point before MAP |
| MRP (Migration Readiness Planning) | Post-MRA; customer committed, needs execution plan | All | Free; follows MRA |
| AWS Cloud Resilience Program | Findings show availability/DR gaps; production workloads at risk | Enterprise | Free |
| Assessment Central | Customer doesn't know which assessment to start with; need hub view | All | Free; umbrella for OLA/Storage/etc. |

### ProServe & Engagement (not in Tier 1)
| Program | Trigger Condition | Segment | Notes |
|---------|-------------------|---------|-------|
| Project Vidya | Internal: SA/account team needs AI-powered customer research prep before engagement | Internal | Agentic consulting platform |
| Project Uplift | Customer needs multiple engagement types combined (EBA + CDP + Jumpstart) | Enterprise | Combined package |
| Mainframe Modernization Service | COBOL/mainframe workloads detected; committed to replatform/refactor | Enterprise | ProServe-led (paid) |
| The RAPID Initiative | VMware/IMM pipeline acceleration; 5-step formula for any IMM deal | Enterprise | Programs + funding |

### Partner & ISV (not in Tier 1)
| Program | Trigger Condition | Segment | Notes |
|---------|-------------------|---------|-------|
| ISV WMP (Workload Migration Program) | ISV partner migrating customer workloads to their SaaS platform | ISV | GTM + funding; expanding to BYOL Q2 2026 |
| OneSaaS | ISV or services firm adopting/offering SaaS; any maturity stage | ISV | GTM resources |
| AWS Marketplace Multi-Product Solutions | ISV with multiple products wanting bundled Marketplace listing | ISV | Listing capability |
| ISV MDF (Marketing Dev Funds) | ISVA partner needing marketing development support ($25K) | ISV | $25K; requires PRM + Co-Sell |
| BOX (Business Outcomes Xcelerator) | Partner focused on measurable business outcomes, not just tech deployment | Partners | Expanded to BCAPs at GPS 2026 |
| BVR (Business Value Realization) | Post-sale; customer adopted AWS; partner leads value realization tracking | Enterprise | Launching Q2 2026 at NYC Summit |
| PGP (Partner Greenfield Program) | Partner building new AWS practice in Migration, GenAI, or Security | Partners | Enablement + funding + co-sell |
| SBAI (Small Business Accelerator) | Partner-led/indirect selling to SMB, ISV, or mid-size customers | SMB, ISV | Tools + enablement + GTM |
| MSP Incremental Growth Incentive | MSP partner with >15% YoY managed services revenue growth | Partners (MSP) | 10–25% of incremental rev (cap $5M) |
| MPOPP (Marketplace Private Offer Partner Program) | Partner transacting through Marketplace private offers | Partners | Incentives |
| RAPID for ISVs | Small/medium ISV growing through Distributors | ISV | Launching Q4 2026 |
| RAPID for Marketplace | Reseller driving customer purchases through Marketplace/CPPO | Partners | Launching Q4 2026 |

### Startup (not in Tier 1)
| Program | Trigger Condition | Segment | Notes |
|---------|-------------------|---------|-------|
| AWS Global Startup Program | Startup at any stage; comprehensive engagement needed | Startup | Full resource access |
| Kiro Startup Credits | AI-native startup using AI-powered dev tools | Startup | 3 credit pathways |
| Worldwide Startup Partners Hub | Startup ISV onboarding to APN | Startup | Onboarding resources |

### GTM Motions & Sales Plays (not in Tier 1)
| Program | Trigger Condition | Segment | Notes |
|---------|-------------------|---------|-------|
| Agentic AI for SaaS Providers & ISVs | Customer is SaaS/ISV exploring agentic AI opportunities | ISV | Sales play |
| Efficient Compute Sales Plays | Findings show compute cost concerns; right-sizing opportunity | Enterprise | GTM motion |
| AWS Security Agent Sales Play | Customer interested in automated security across dev lifecycle | Enterprise | Sales play |
| Zero Trust for AI Sales Play | Customer building AI; needs to prove identity/data flow authorization | Enterprise | 3-phase engagement |
| SAP RISE Acceleration Sales Play | SAP customer; RISE migration opportunity | Enterprise | AGI sales play |
| Enterprise Support Sales Play | Gap in current support coverage identified | Enterprise | Sales play |

### Training & Enablement (not in Tier 1)
| Program | Trigger Condition | Segment | Notes |
|---------|-------------------|---------|-------|
| AWS GameDay | Technical team wants hands-on gamified learning on real scenarios | All | Free |
| VMCCO Bar Raiser Program | Internal: migration specialist wanting expedited AMA approvals (5d vs 27d) | Internal | Certification |
| Database Upskill Program | Customer/partner team doing DB migration; skill gap in target DB | Enterprise | Training |

### Workload-Specific (not in Tier 1)
| Program | Trigger Condition | Segment | Notes |
|---------|-------------------|---------|-------|
| Countdown Premium/Platinum | Complex database migration needing tiered support | Enterprise | Paid support tiers |
| AWS Transform for Windows | Windows/.NET/IIS workloads; code repo available for automated analysis | Enterprise | Free (AI-powered tool) |
| Mainframe Modernization (WWPS) | WWPS customer with mainframe; committed + budgeted | WWPS | ProServe (paid) |
| SAP on AWS | SAP workload migration; MAP eligible + AGI-funded | Enterprise | MAP + AGI |
| End of Support Migration | Customer on EOL software (Win Server 2012, SQL 2014, RHEL 7, etc.) | Enterprise | MAP eligible |
| Think Big for Small Business Boost (TBSB) | Public sector small business focus | WWPS only | Varies |
| Partner Transformation Program (PTP) | WWPS partner transformation | WWPS only | Varies |
| SMB Competency (updated Q2 2026) | Partner with SMB Competency; greenfield SMB efforts | Partners (SMB) | $25K MDF + community |
| Amazon Connect Competency | Partner with 4+ Connect case studies; implementation expertise | Partners | Launching Q2 2026 |

---

## AGENT REASONING CHECKLIST

After selecting Tier 1 recommendations, verify before emitting:

1. ☐ Did I check whether the customer's workload type (VMware, Windows, Mainframe, Oracle, SAP, Kafka) has a workload-specific program?
2. ☐ Did I check whether the customer is a Startup or ISV (different program universe)?
3. ☐ Did I check whether the customer is WWPS (geo-restricted programs available)?
4. ☐ Did I include at least one entry-point program (no prerequisites)?
5. ☐ Did I avoid recommending follow-on programs without their prerequisites?
6. ☐ Did I cap recommendations at 3–5 (avoid overwhelming the seller)?
7. ☐ Did I sequence recommendations logically? (Assessment → Funding → Execution → Optimization; and for ARA anchors, AI DLC → AXE → Innovation EBA)
8. ☐ Did I group output as Funded Programs → Engagement Models → GTM Motions?
9. ☐ Did I exclude any `Retiring` programs and any `Launching` programs whose launch is not imminent?
10. ☐ Did I avoid exposing the internal MOD 1–4 maturity score anywhere in the output?

---

## STATUS KEY

- All programs listed here are **Active** as of June 2026 unless noted below.
- **Launching** (do not recommend unless launch is imminent): BVR (Q2 2026, NYC Summit), Amazon Connect Competency (Q2 2026), RAPID for ISVs (Q4 2026), RAPID for Marketplace (Q4 2026).
- **Evolving:** MAP is evolving to "Unified MAP" (migration + AI) at re:Invent 2026. ISV WMP expanding scope to BYOL + net-new in Q2 2026.
- No programs are currently marked **Retiring**. If a future revision marks a program Retiring, the agent MUST NOT recommend it.

---

*Last updated: 2026-06-03*
*Source: APN Programs Roadmap (Apr 2026) + AWS Highspot (Jun 2026)*
*Programs indexed: 88 — Tier 1 detailed: 35 (32 source + 3 ARA agentic anchors); Tier 2 compact: 53*
