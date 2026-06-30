# AWS Program & GTM Library

> **Purpose:** This reference is loaded by the Portfolio Agentic Readiness (portfolio-ara) and Portfolio Modernization Readiness (portfolio-mod) Task Definitions during their program-recommendation step. The analysis agent uses it to recommend relevant AWS programs and GTM motions in the "Next Steps / Recommended Programs" section of the generated portfolio report, based on the actual findings already produced.
>
> **Scope:** Program recommendations are an engagement-level decision and are produced ONLY by the two portfolio TDs — never by the per-repo ARA or MOD TDs. The portfolio view has the cross-repo and customer-segment context required to qualify these programs.
>
> **Source:** APN Programs Roadmap (Apr 2026) + AWS Highspot (Jun 2026). Compiled by Kevin Shin, 2026-06-15. Programs indexed: 42 — Tier 1 detailed: 34 (31 from the source library + 3 ARA agentic anchor programs); Tier 2 compact index: 8.

---

## How the Agent Uses This File

After the portfolio analysis has produced its findings (cross-cutting BLOCKERs/RISKs and readiness profiles for ARA; aggregated pathways, severity counts, and classification tiers for MOD), evaluate which programs are relevant and emit a short recommendation list. Follow these rules exactly:

1. **Recommend only when qualification criteria are met.** Each program lists signal patterns, "DO NOT recommend when" exclusions, and qualification criteria. A program is eligible only when its signal patterns match the findings AND none of its exclusions apply.
2. **Cap at 3–5 recommendations per report.** Never exceed 5. Fewer is better than overwhelming the customer.
3. **Prioritize in this order:**
   1. Direct finding match (the strongest signal pattern matches an actual finding)
   2. Customer segment fit (Enterprise / SMB / ISV / Startup / WWPS — inferred from portfolio `context` and `service_inventory`)
   3. Entry-point programs (no prerequisites) before follow-on programs (with prerequisites)
4. **Group recommendations under two headings, in this order:** `Funded Programs` → `Engagement Models`. Assessments, credits, tools, and self-service resources map under Funded Programs; hands-on engagements, workshops, and training map under Engagement Models.
5. **Never recommend programs marked `Retiring`** and never recommend programs marked `Launching` unless the launch is imminent (see Status Key below).
6. **Sequence logically:** Assessment → Funding → Execution → Optimization. Do not recommend a follow-on program without surfacing its prerequisite.
7. **Do not expose internal scoring.** The MOD internal 1–4 maturity score is internal only. When citing MOD evidence in a recommendation, reference unified severity (`High` / `Medium` / `Low`), `severity_status` (`Ready` / `Needs Work` / `Critical`), `score_rating` (`Mature` / `Partial` / `Needs Work` / `Not Ready`), or pathway/profile names — never the numeric score.
8. **Assessment overlap rule:** Recommend only ONE assessment per domain. For database findings, pick ONE of: DBC (speed, days), DBOLA (licensing depth, weeks), RDS Cost Assessment (rehost-only TCO), or OLA for Databases (general infra). Never stack multiple assessments for the same problem.
9. **EBA vs AML rule:** EBA = "learn by doing on real production workloads" (execution-focused, for stalled deals). AML = "structured training program with guided labs" (learning-focused, for skill building). Pick one, not both.
10. **Self-service alternative:** If the customer may not have a dedicated AWS account team (SMB, startup), always include at least one self-service option (Transform tools, Migration Evaluator, Skill Builder, workshop catalog).
11. **Run the reasoning checklist** (at the end of this file) before finalizing the list.

### Status Key

| Status | Meaning |
|--------|---------|
| `Active` | Generally available, recommend freely |
| `Launching` | Announced but not yet GA; recommend only if launch ≤30 days away |
| `Retiring` | Being phased out; NEVER recommend |
| `Pilot` | Limited availability; note region/segment restrictions |

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

### AI DLC (AI Driven Development Lifecycle) `[ARA-anchor]` `Active`
- **Signal patterns:** Portfolio shows teams without established AI-assisted development practices, or engineering-maturity findings indicate manual development workflows that could benefit from AI-driven automation. ARA shows `Pilot-Ready` or `Agent-Ready`; customer wants a structured methodology for AI-powered software development; MOD `Move to AI` pathway detected; customer has development teams ready to adopt AI-augmented workflows.
- **DO NOT recommend when:** Customer needs modernization before they can build with AI (recommend MAP/AppMod first); customer has no development team; findings show architecture is not ready for AI integration.
- **How to evaluate:** Check `Engineering Maturity` (ENG) findings across the portfolio. If 50%+ of services have a `Medium`+ finding on ENG-Q1 (Infra Governance), ENG-Q2 (CI/CD + Contracts), or ENG-Q3 (Rollback), recommend AI DLC. Also recommend if the portfolio `context` mentions a desire for AI-assisted development practices, or if architecture is at/near `Pilot-Ready`/`Agent-Ready`.
- **What the customer gets:** A structured methodology where AI handles planning, task decomposition, and code generation while developers retain control of validation and decisions. Delivers 2–5x development velocity gains. Includes hands-on engagement with AWS experts to implement the methodology across the development lifecycle.
- **How to engage:** Talk to your AWS account team about AI-DLC. Based on your agentic readiness classification, your architecture is positioned to adopt AI-driven development practices.
- **Time to value:** Weeks (methodology adoption); ongoing velocity gains.
- **Segment:** All.
- **Sequencing:** Run first — establishes AI-driven development practices before agentic work.
- **Prerequisite:** Architecture at or near `Pilot-Ready` / `Agent-Ready` per ARA findings.
- **Pairs with:** AXE, Innovation EBA, Agentic Catalyst Program.

### AXE (Agent Experience Engagement) `[ARA-anchor]` `Active`
- **Signal patterns:** Portfolio shows 3+ services in `Pilot-Ready` or `Agent-Ready` state, or business has defined customer/employee experience goals but lacks a technical implementation roadmap.
- **DO NOT recommend when:** Customer has fewer than 3 services at `Pilot-Ready`+; customer needs modernization before AI (recommend MAP/AppMod); customer already has an agentic implementation plan.
- **How to evaluate:** Count services with profile `Agent-Ready` or `Pilot-Ready`. If count >= 3, recommend AXE. Also recommend if the portfolio `context` describes experience-level goals (e.g., "customer support agent", "employee productivity") without a corresponding technical implementation plan.
- **What the customer gets:** A strategic methodology built on the proven D2E methodology (580+ successful engagements) delivering a six-phase framework: business process mapping, task identification, evaluation metrics, data architecture, governance, and guardrails. The Guardrails & Boundaries phase aligns with ARA — together they provide a complete assess-to-implement pathway: ARA validates system readiness while AXE designs the agent experience and implementation roadmap.
- **How to engage:** Talk to your AWS account team about AXE. Given your portfolio's agentic readiness, this engagement designs the agent experience and implementation roadmap.
- **Segment:** Enterprise.
- **Sequencing:** Run after AI DLC to design the agent experience.
- **Pairs with:** AI DLC, Innovation EBA, ACP.

### Innovation EBA (AIML-GenAI) `[ARA-anchor]` `Active`
- **Signal patterns:** Portfolio `context` indicates AI/ML or GenAI is a strategic imperative, executive sponsorship exists, use cases deliver critical business value, a data strategy exists, and the customer is committed to production deployment within ~90 days. The portfolio should also show a backlog of AIML-GenAI use cases and a customer team committed to upskilling.
- **DO NOT recommend when:** Customer has no executive sponsorship; no data strategy; no GenAI use cases identified; customer needs modernization before AI.
- **How to evaluate:** Check portfolio `context` for: (1) AI/ML or GenAI as strategic priority, (2) executive sponsorship, (3) existing data and data strategy (services with established data pipelines, DynamoDB/Aurora/S3 data stores), (4) use cases in customer experience (chatbots, post-call analytics, personalization), productivity (intelligent search, summarization, code generation), business operations (IDP, fraud detection, predictive maintenance), or content creation. Also recommend if 3+ services have production-ready data stores AND the `context` describes GenAI ambitions beyond what AXE alone covers.
- **What the customer gets:** A 3-day sprint-based, interactive engagement following the 4-step EBA framework (Executive Alignment → Readiness → Accelerate → Transform At Scale) with workstreams including Foundations, Data Engineering, GenAI Build/Evaluate, UI Integration, ML Ops, and Command Center. Develops skills through learning-by-doing and builds/accelerates a GenAI use case pipeline.
- **How to engage:** Talk to your AWS account team about Innovation EBA. Your portfolio shows strong data foundations and GenAI ambitions — this engagement accelerates a use case into production.
- **Segment:** Enterprise (higher cloud maturity).
- **Sequencing:** Run when the customer is ready to accelerate a use case into production; may run in parallel with AXE if use cases are independent.
- **Pairs with:** AI DLC, AXE, GenAI Innovation Center.

---

## FUNDED PROGRAMS

> Assessments (no cost to customer) and credit/funding programs group here. Assessments are entry points; funded programs require qualification.

### OLA (Optimization & Licensing Assessment) `[MOD]` `Active`
- **Signal patterns:** MOD findings indicate on-prem workloads needing migration; customer hasn't quantified savings; VMware or Microsoft licensing referenced in portfolio `context`.
- **DO NOT recommend when:** Customer already has business case data; workloads already on AWS; customer only has cloud-native workloads.
- **Qualification:** Customer has on-prem workloads; willing to share infrastructure data.
- **What the customer gets:** Comprehensive analysis of current compute, storage, and licensing costs with modeled AWS savings (avg 36% compute savings, 45% licensing reduction).
- **How to engage:** Talk to your AWS account team about an Optimization & Licensing Assessment. This no-cost assessment analyzes your current infrastructure and licensing, showing projected savings on AWS.
- **Time to value:** 2–3 weeks.
- **Prerequisite:** None (entry point).
- **Pairs with:** MAP, Migration Evaluator.

### OLA for Databases `[MOD]` `Active`
- **Signal patterns:** MOD `Move to Managed Databases` pathway triggered; on-prem Oracle/SQL Server detected in `context`; licensing cost is a migration blocker.
- **DO NOT recommend when:** Customer already committed to DB migration path; no database licensing concerns.
- **What the customer gets:** Database-specific licensing analysis with migration options and cost modeling.
- **How to engage:** Talk to your AWS account team about a Database Optimization Assessment.
- **Prerequisite:** None.
- **Pairs with:** MAP, DBC.

### OLA for VMware `[MOD]` `Active`
- **Signal patterns:** VMware infrastructure detected in portfolio `context`; Broadcom licensing concerns; evaluating alternatives.
- **DO NOT recommend when:** Customer not running VMware; no VMware references in `context` or IaC.
- **What the customer gets:** VMware-specific analysis with modeled costs across AWS migration pathways.
- **How to engage:** Talk to your AWS account team about a VMware optimization assessment.
- **Prerequisite:** None.
- **Pairs with:** MAP, VMware Modernization Program.

### DBC (Directional Business Case) `[MOD]` `Active`
- **Signal patterns:** MOD `Move to Managed Databases` pathway detected; customer needs quick financial justification for database migration; early-stage conversation.
- **DO NOT recommend when:** Customer already has detailed TCO data (recommend DBOLA for deeper analysis); customer already committed to migration (recommend MAP).
- **What the customer gets:** Rapid, high-level financial comparison of current database costs vs. AWS managed services. Delivered in days, not weeks.
- **How to engage:** Talk to your AWS account team about running a Directional Business Case.
- **Time to value:** Days.
- **Prerequisite:** None (entry point, often first step before DBOLA).
- **Pairs with:** DBOLA, AWS Transform for SQL Server, MAP.

### DBOLA (Database Optimization & Licensing Assessment) `[MOD]` `Active`
- **Signal patterns:** MOD `Move to Managed Databases` pathway with Oracle or SQL Server detected; customer has licensing concerns blocking migration decision; needs prescriptive post-migration licensing position.
- **DO NOT recommend when:** Customer doesn't have licensing concerns (recommend DBC instead); customer already resolved licensing questions.
- **What the customer gets:** Prescriptive Oracle/SQL Server licensing guidance delivered by a licensing specialty partner. Provides detailed post-migration effective licensing position.
- **How to engage:** Talk to your AWS account team about a Database Optimization & Licensing Assessment.
- **Time to value:** Weeks.
- **Prerequisite:** None (can run in parallel with DBC).
- **Pairs with:** DBC, OLA for Databases, MAP.

### Migration Evaluator `[MOD]` `Active`
- **Signal patterns:** Early-stage; customer considering migration but has no data; needs directional business case; referenced in portfolio `context`.
- **DO NOT recommend when:** Customer already has OLA or detailed inventory data.
- **What the customer gets:** Data-driven business case for migration with projected costs and savings, at no cost.
- **How to engage:** Self-service at https://aws.amazon.com/migration-evaluator/ or request through your AWS team.
- **Time to value:** 1–2 weeks.
- **Prerequisite:** None (entry point).
- **Pairs with:** OLA, MAP.

### Well-Architected Review `[ARA+MOD]` `Active`
- **Signal patterns:** ARA `Engineering Maturity` or `Observability` dimensions have 2+ `Medium`/`High` findings; MOD findings span multiple architectural categories.
- **DO NOT recommend when:** Customer already completed a recent review; ARA/MODA findings already comprehensively cover the customer's architectural concerns (ARA IS an architecture review); findings are narrowly focused on one dimension.
- **What the customer gets:** Free architecture review against 6 pillars with prioritized recommendations.
- **How to engage:** Request through your AWS account team or an AWS Partner.
- **Time to value:** 1–2 weeks.
- **Prerequisite:** None.
- **Pairs with:** MAP.

### AI Assessment `[ARA]` `Active`
- **Signal patterns:** ARA shows `Pilot-Ready` or `Agent-Ready`; customer wants to define AI/agentic strategy but hasn't started; needs ROI justification.
- **DO NOT recommend when:** Customer already has AI strategy defined; findings are all about modernization not AI.
- **Qualification:** Any customer considering AI adoption.
- **Funding:** Up to $15K (SMB) / $30K (Enterprise).
- **What the customer gets:** Funded AI strategy assessment including use case discovery, feasibility analysis, and ROI modeling.
- **How to engage:** Talk to your AWS account team about the AI Assessment Program.
- **Time to value:** 2–3 weeks.
- **Prerequisite:** None (entry point).
- **Pairs with:** Agentic Catalyst Program, GenAI Innovation Center.

### MAP (Migration Acceleration Program) `[ARA+MOD]` `Active`
- **Signal patterns:** 3+ High-severity findings across any ARA dimension; MOD shows multiple pathways requiring significant investment; portfolio-scale modernization needed; customer has migration-scale workload referenced in `context`.
- **DO NOT recommend when:** Single-app modernization only (recommend AppMod PoC); customer only needs assessment (recommend OLA); opportunity <$500K ARR; workload already running on AWS with no net-new migration.
- **Qualification:** $500K+ ARR opportunity; committed migration/modernization plan; partner engaged; workloads identified.
- **Funding:** Credits + partner cash (up to 30% ARR via SPI).
- **What the customer gets:** AWS credits, partner funding, tools, automation, training, and expert support to accelerate migration and modernization.
- **How to engage:** Talk to your AWS account team about the Migration Acceleration Program (MAP).
- **Time to value:** 3–6 months.
- **Prerequisite:** OLA or Migration Evaluator recommended first.
- **Pairs with:** EBA, OLA, AppMod Assessment.

### MAP for AI Modernization `[ARA+MOD]` `Active`
- **Signal patterns:** ARA profile is `Remediation Required` or `Pilot-Ready` AND customer has a modernization need to enable agentic/AI workloads; MOD `Move to AI` pathway triggered.
- **DO NOT recommend when:** No modernization needed; architecture already agent-ready (ARA `Agent-Ready`).
- **Qualification:** MAP-eligible opp + AI modernization use case.
- **Funding:** MAP credits (AI use cases).
- **What the customer gets:** MAP credits and support specifically for modernizing applications to support AI/agent workloads.
- **How to engage:** Ask your AWS account team about MAP for AI Modernization.
- **Prerequisite:** Standard MAP qualification + AI use case validation.
- **Pairs with:** AI Assessment, Agentic Catalyst Program.

### AppMod PoC Funding `[MOD]` `Active`
- **Signal patterns:** MOD pathway detected (`Move to Containers` or `Move to Cloud Native`) and customer wants to validate approach on a specific application before scaling.
- **DO NOT recommend when:** Customer needs full business case first (recommend DBC or OLA); scope is portfolio-wide (recommend MAP).
- **Qualification:** Identified modernization target; technical team available; needs feasibility proof.
- **Funding:** Up to $100K in co-funding for partner-led engagements.
- **What the customer gets:** Funded proof-of-concept to validate containers/serverless modernization on a real application.
- **How to engage:** Ask your AWS account team about AppMod PoC funding.
- **Time to value:** 2–4 weeks.
- **Prerequisite:** None (can be entry point or post-assessment).
- **Pairs with:** MAP.

### Microsoft Modernization Program `[MOD]` `Active`
- **Signal patterns:** MOD findings reference Windows Server, .NET Framework, IIS, SQL Server; `Move to Containers` or `Move to Cloud Native` for Windows workloads.
- **DO NOT recommend when:** No Windows/Microsoft workloads.
- **Qualification:** Windows/.NET workloads with modernization path identified.
- **What the customer gets:** AWS-funded partner solutions to accelerate Windows and .NET modernization.
- **How to engage:** Ask your AWS account team about the Microsoft Modernization Program.
- **Pairs with:** AML, AWS Transform for Windows.

### VMware Modernization Program `[MOD]` `Active`
- **Signal patterns:** Large VMware estate detected in portfolio `context`; infrastructure modernization needed; Broadcom licensing pressure.
- **DO NOT recommend when:** No VMware workloads; small VM count; no VMware references in `context` or IaC.
- **Qualification:** VMware workloads migrating to AWS; partner engaged.
- **What the customer gets:** Partner-funded VMware modernization support including assessment, migration planning, and execution.
- **How to engage:** Ask your AWS account team about VMware migration programs.
- **Pairs with:** OLA for VMware, MAP.

### AWS Modernization Assurance (AMA) `[MOD]` `Active`
- **Signal patterns:** Large VMware estate (2000+ VMs) referenced in `context`; competitive risk; urgent migration timeline.
- **DO NOT recommend when:** <2000 VMs; opportunity <$2M; no competitive pressure; timeline >12 months.
- **Qualification:** 2,000+ VMs; $2M+ scope; migration within 12 months; executive commitment.
- **What the customer gets:** Funding covering migration costs, up to 50% of first-year run costs, training, and licensing support.
- **How to engage:** Ask your AWS account team about enterprise VMware migration funding.
- **Time to value:** 6–12 months.
- **Prerequisite:** OLA completed; MAP qualified.
- **Pairs with:** MAP, VMware Modernization Program.

### AWS-Funded ISV Tooling `[MOD]` `Active`
- **Signal patterns:** MOD findings show complex migration/modernization scope where specialized third-party tools would accelerate execution; customer or partner needs automated discovery, assessment, or migration tooling beyond AWS native services.
- **DO NOT recommend when:** Simple migration achievable with AWS native tools (Application Migration Service, DMS); customer at prospect/pilot/PoC stage (must be Qualified+).
- **Qualification:** Active migration/modernization project; working with AWS Partner with Migration & Modernization Competency or MSP designation.
- **What the customer gets:** Fully funded access to specialized third-party ISV tools (CAST, CloudHedge, Cloudamize, vFunction, RiverMeadow, MontyCloud) for automated discovery, assessment, planning, and migration execution.
- **How to engage:** Talk to your AWS account team about funded ISV tooling for your migration.
- **Time to value:** Weeks (tool deployment + automated assessment).
- **Prerequisite:** Active migration/modernization project with an AWS Partner.
- **Pairs with:** MAP, OLA, EBA, AppMod PoC Funding.

### AWS Activate (Startup Credits) `[ARA+MOD]` `Active`
- **Signal patterns:** Customer is an early-stage startup (pre-Series B); needs credits to fund modernization or build agentic applications.
- **DO NOT recommend when:** Customer is an established enterprise; customer already has significant AWS spend.
- **Qualification:** Self-funded or pre-Series B; funded within last 12 months; founded in past 10 years.
- **What the customer gets:** Tiered AWS credits: Bootstrapped ($1K), Pre-Seed ($5–25K), Seed ($100K), Series A ($200K). Covers AWS services including Bedrock 3rd-party models.
- **How to engage:** Apply at https://aws.amazon.com/activate/ or through your accelerator/incubator program.
- **Prerequisite:** None.
- **Pairs with:** IW Programs.

### IW (Incremental Workloads) Programs for Startups `[ARA+MOD]` `Active`
- **Signal patterns:** Startup customer with findings indicating migration from competitive platform, or needing AI/ML assessment, or adopting new AWS services strategically.
- **DO NOT recommend when:** Customer is not in startup segment; enterprise customer (use MAP instead).
- **Qualification:** Startup company.
- **What the customer gets:** Funded programs tailored for startups: IW Assess ($5K flat for AI/ML assessments; up to 8% ARR capped at $10K for migration assessments), IW Build (up to 25% of incremental ARR), IW Migrate (up to 25% of ARR for migrating from competitive platforms).
- **How to engage:** Talk to your AWS startup account team about Incremental Workloads funding.
- **Time to value:** Weeks.
- **Prerequisite:** Active startup.
- **Pairs with:** AWS Activate, MAP (if graduating to enterprise).

### Activate4GF (Greenfield Credits) `[ARA+MOD]` `Active`
- **Signal patterns:** Customer is new to AWS (greenfield); any segment; portfolio `context` shows workloads currently on-prem or competitive cloud; customer exploring AWS for the first time.
- **DO NOT recommend when:** Customer already has significant AWS footprint; customer already MAP-qualified.
- **Qualification:** Greenfield customer (new to AWS) across all segments.
- **What the customer gets:** AWS Service Credits to accelerate cloud adoption: explore services, migrate workloads, or build AI/ML solutions.
- **How to engage:** Talk to your AWS account team about greenfield credits.
- **Prerequisite:** Must be greenfield (new to AWS).
- **Pairs with:** OLA, MAP, AWS Activate (startups).

---

## ENGAGEMENT MODELS

> Hands-on engagements, workshops, skill-building programs, and training map here. These require customer team commitment.

### EBA (Experience-Based Acceleration) `[ARA+MOD]` `Active`
- **Signal patterns:** Multiple `High` effort remediation items in findings; customer team lacks hands-on experience with target architecture; deal stalled on technical validation. (MOD: 2+ services with a triggered pathway AND `Partial`/`Needs Work`/`Not Ready` classification.)
- **DO NOT recommend when:** Customer has strong internal engineering team; findings are mostly Low effort; customer just needs assessment; customer needs training not execution (recommend AML).
- **Qualification:** Customer commits team for immersive multi-day engagement; executive sponsor; >$500K ARR.
- **What the customer gets:** Structured, immersive engagement where your team and AWS/partner experts migrate real workloads together, building skills while delivering results.
- **How to engage:** Talk to your AWS account team about Experience-Based Acceleration.
- **Time to value:** 4–8 weeks.
- **Prerequisite:** Modernization target identified; technical scope defined.
- **Pairs with:** MAP, AML.

### AML (Application Modernization Lab) `[MOD]` `Active`
- **Signal patterns:** MOD `Move to Containers` or `Move to Cloud Native` pathway + customer team needs both training and guided execution on modernization techniques.
- **DO NOT recommend when:** Customer just needs a PoC (recommend AppMod PoC); team already experienced with target architecture; customer needs execution not learning (recommend EBA).
- **Qualification:** Customer team available for training + guided modernization.
- **What the customer gets:** Hands-on modernization training combined with guided execution on your actual applications.
- **How to engage:** Talk to your AWS account team about the Application Modernization Lab.
- **Time to value:** 4–8 weeks.
- **Prerequisite:** Modernization target identified.
- **Pairs with:** EBA, MAP, Microsoft Modernization Program.

### Agentic Catalyst Program (ACP) `[ARA]` `Active`
- **Signal patterns:** ARA shows `Pilot-Ready` or `Agent-Ready`; customer (ISV) wants to build agentic AI products; in ideation stage of agentic strategy.
- **DO NOT recommend when:** Customer is not an ISV; needs modernization before AI; already has agentic products in production.
- **Qualification:** ISV; in ideation stage; willing to dedicate executive + technical team for 1 week.
- **What the customer gets:** Week-long accelerated engagement: executive alignment, curated use cases, technical build days, solution architecture, and ROI preview.
- **How to engage:** Talk to your AWS account team about the Agentic Catalyst Program.
- **Time to value:** 1 week (engagement) → 12 months (production).
- **Prerequisite:** None (entry point for ISVs).
- **Pairs with:** ISV Booster, AI Assessment.

### Immersion Days `[ARA+MOD]` `Active`
- **Signal patterns:** ARA findings show specific technology skill gaps (containers, serverless, observability); MOD pathway requires technology customer hasn't used before.
- **DO NOT recommend when:** Customer team already skilled in target technology; problem is funding/strategy not skills.
- **Qualification:** Technical team available for 1-day hands-on workshop.
- **What the customer gets:** Free, hands-on deep-dive workshop on specific AWS services relevant to your modernization path.
- **How to engage:** Ask your AWS account team about Immersion Days for [specific technology].
- **Time to value:** 1 day.
- **Prerequisite:** Specific skill gap identified from findings.
- **Pairs with:** EBA, AML.

### GenAI Innovation Center `[ARA]` `Active`
- **Signal patterns:** ARA shows `Agent-Ready`; customer wants to co-innovate on GenAI/agentic solutions (not just integrate agents into existing apps).
- **DO NOT recommend when:** Customer needs modernization first; only wants agent integration (recommend ACP or AI Assessment).
- **Qualification:** Strategic customer building GenAI solutions; willing to co-innovate with AWS.
- **What the customer gets:** Comprehensive GenAI innovation program with AWS experts to develop cutting-edge solutions from ideation through delivery.
- **How to engage:** Talk to your AWS account team about the Generative AI Innovation Center.
- **Prerequisite:** AI strategy defined; architecture ready.
- **Pairs with:** AI Assessment, ACP.

### ProServe Residency `[ARA+MOD]` `Active`
- **Signal patterns:** ARA shows `Remediation Required` with 10+ `High`/`Medium` findings spanning most dimensions; MOD shows complex multi-pathway modernization across 5+ services; sustained expert support needed over months.
- **DO NOT recommend when:** Findings are focused (1–2 dimensions); workshops + PoC would suffice.
- **Qualification:** Complex transformation; budget for engagement; 3–12 month program.
- **What the customer gets:** Dedicated AWS experts embedded alongside your team for months, providing continuous architecture guidance and hands-on execution support.
- **How to engage:** Ask your AWS account team about ProServe Residency engagements.
- **Time to value:** 3–12 months.
- **Prerequisite:** Scope defined; budget available.
- **Pairs with:** MAP (to fund), EBA (lighter alternative).

### AgentStorming Workshop `[ARA]` `Active`
- **Signal patterns:** ARA report generated but customer wants to identify WHERE to deploy agents across their business processes (beyond code-level readiness).
- **DO NOT recommend when:** Customer only needs code-level remediation; not ready for process-level thinking.
- **What the customer gets:** Facilitated workshop combining cognitive complexity analysis with process discovery to identify high-value opportunities for AI agent deployment across your business.
- **How to engage:** Talk to your AWS account team about an AgentStorming workshop.
- **Pairs with:** ARA/MODA (code-level), Agentic Catalyst (ISVs).

### AWS AI League `[ARA]` `Active`
- **Signal patterns:** ARA `Engineering Maturity` dimension has 2+ `Medium`/`High` findings indicating team skill gaps in AI/agent development; customer wants to upskill teams before implementing agents.
- **What the customer gets:** Gamified team-based AI tournament focused on model customization and agent building.
- **How to engage:** Ask your AWS account team about hosting an AWS AI League event.
- **Pairs with:** Immersion Days, Agentic Catalyst.

### MMA Workshop (Migration and Modernization Acceleration) `[MOD]` `Active`
- **Signal patterns:** MOD `Move to Managed Databases` pathway with SQL Server, Oracle, or Sybase detected; customer team needs hands-on migration experience before committing; customer wants to understand GenAI-accelerated migration approach.
- **DO NOT recommend when:** Customer has no database migration need; customer already experienced with AWS DMS/SCT and Aurora PostgreSQL; opportunity <$100K ARR.
- **Qualification:** Customer with identified database modernization opportunity; technical team available (Cloud Architects, DBAs, App Developers); targets SQL Server, Oracle, or Sybase to Aurora PostgreSQL.
- **What the customer gets:** Full-day immersive workshop covering end-to-end database migration to Aurora PostgreSQL using GenAI-powered tools. Hands-on labs with real applications: schema conversion, stored procedure migration with GenAI, application SQL conversion, data migration with AWS DMS, and automated test generation.
- **How to engage:** Talk to your AWS account team about the MMA Workshop.
- **Time to value:** 1 day (workshop).
- **Prerequisite:** Aurora PostgreSQL Immersion Day recommended (not required).
- **Available tracks:** SQL Server (.NET), Oracle (Java), Sybase ASE.
- **Self-paced links:** [SQL Server](https://catalog.workshops.aws/mma-mssql-pg/en-US) | [Oracle](https://catalog.workshops.aws/mma-oracle-pg/en-US) | [Sybase](https://catalog.workshops.aws/mma-sybase-pg)
- **Pairs with:** DBC, DBOLA, AWS Transform for SQL Server, EBA, MAP.

### SHIP (Security Health Improvement Program) `[MOD]` `Active`
- **Signal patterns:** MOD findings indicate AWS security infrastructure gaps: missing CloudTrail, no encryption at rest, no GuardDuty/Security Hub, missing IAM best practices, no VPC flow logs. Multiple security-category findings with `severity_status` of `Needs Work` or `Critical`.
- **DO NOT recommend when:** Security findings are application-level auth/authz only (those are ARA concerns, not SHIP); customer already has a security improvement plan; findings are isolated (single finding).
- **What the customer gets:** Free AWS security posture assessment with personalized improvement roadmap covering identity, detection, infrastructure protection, data protection, and incident response.
- **How to engage:** Talk to your AWS account team about the Security Health Improvement Program.
- **Pairs with:** Well-Architected Review, MAP.

---

## SELF-SERVICE TOOLS

> These are customer-facing, no-cost tools that customers can use immediately. They group under **Funded Programs** in the rendered output.

### AWS Transform Custom (ARA/MODA) `[ARA+MOD]` `Active`
- **Signal patterns:** Customer has additional repositories not yet analyzed; wants to expand assessment scope.
- **What the customer gets:** AI-powered code analysis producing agentic readiness scoring and modernization recommendations for additional applications.
- **How to engage:** Self-service via AWS Transform Custom console.
- **Prerequisite:** None.
- **Pairs with:** MAP.

### AWS Transform for Windows `[MOD]` `Active`
- **Signal patterns:** MOD findings reference Windows/.NET/IIS workloads; `Move to Containers` or `Move to Cloud Native` pathway.
- **What the customer gets:** AI-powered automated analysis and transformation planning for Windows and .NET workloads.
- **How to engage:** Self-service via AWS Transform console.
- **Pairs with:** Microsoft Modernization Program, AML.

### AWS Transform for SQL Server `[MOD]` `Active`
- **Signal patterns:** MOD `Move to Managed Databases` pathway with SQL Server detected; stored procedures, T-SQL, or SQL Server schemas referenced in findings.
- **DO NOT recommend when:** Customer wants to stay on SQL Server (recommend RDS for SQL Server instead); no SQL Server workloads detected.
- **What the customer gets:** Agentic AI-powered SQL Server to Aurora PostgreSQL modernization: intelligent schema conversion, stored procedure transformation, coordinated application refactoring, and three-tier schema validation. Accelerates migration by up to 5x.
- **How to engage:** Self-service via AWS Transform console at https://aws.amazon.com/transform/windows/sql-server/
- **Time to value:** Days to weeks (depending on schema complexity).
- **Prerequisite:** None (entry point for SQL Server modernization).
- **Pairs with:** DBC, DBOLA, MAP.

### RDS for SQL Server Cost Assessment `[MOD]` `Active`
- **Signal patterns:** Customer considering SQL Server migration but unsure about costs; MOD findings show SQL Server workloads; customer wants to evaluate RDS for SQL Server vs. on-prem TCO.
- **DO NOT recommend when:** Customer already committed to Aurora PostgreSQL migration (recommend AWS Transform for SQL Server instead).
- **What the customer gets:** TCO assessment estimating costs for migrating on-premises SQL Server databases to Amazon RDS for SQL Server.
- **How to engage:** Available within AWS Transform console.
- **Time to value:** Days.
- **Prerequisite:** None.
- **Pairs with:** DBC, DBOLA, MAP.

---

## TIER 2: COMPACT INDEX (Situational programs)

> Scan this index if the customer's workload type, technology stack, or segment suggests a specialized program not covered in Tier 1 above. Only surface these when directly relevant to findings.

### Workload-Specific Programs

| Program | Tag | Status | When to Surface | What Customer Gets |
|---------|-----|--------|----------------|-------------------|
| Oracle DB@AWS Pilot Promotion | `[MOD]` | Active | MOD `Move to Managed Databases` + Oracle detected (NAMER only) | Funded Oracle-to-AWS database migration |
| Kafka Migration Program | `[MOD]` | Active | MOD `Move to Managed Analytics` + Kafka/streaming detected | Funded Kafka-to-MSK migration with MSK Replicator |
| SAP on AWS | `[MOD]` | Active | SAP workloads detected in findings or `context` | Funded SAP migration and optimization on AWS |
| Mainframe Modernization | `[MOD]` | Active | COBOL/mainframe workloads detected in `context` | Assessment, replatform, or refactor for mainframe applications |
| End of Support Migration | `[MOD]` | Active | EOL software detected (Windows Server 2012, SQL 2014, RHEL 7) | Funded migration path off end-of-life platforms |

### ISV/Partner Programs

| Program | Tag | Status | When to Surface | What Customer Gets |
|---------|-----|--------|----------------|-------------------|
| ISV Accelerate | `[ARA]` | Active | Customer is ISV wanting to co-sell with AWS | Joint go-to-market support, co-sell incentives, Marketplace integration |
| ISV Booster Program | `[ARA]` | Active | ISV with $1M–$50M ARR experiencing slow growth | Accelerated growth through Agentic Catalyst + Enhanced Passport + Valuation Readiness |
| AWS SaaS Factory | `[MOD]` | Active | ISV building multi-tenant SaaS; MOD shows SaaS architecture gaps | Architecture guidance and reference implementations for multi-tenant SaaS |

---

## SELF-SERVICE & COMMUNITY RESOURCES

> After listing funded programs and engagements, include 1–2 relevant self-service resources based on findings. These give customers an immediate next step without waiting for account team engagement.

### AWS Connected Community `[ARA+MOD]` `Active`
- **Signal patterns:** Customer is SMB or startup; wants peer networking, expert access, or upcoming events.
- **What the customer gets:** Access to AWS experts, exclusive events, peer community, and curated resources.
- **Link:** https://aws-experience.com

### AWS Skill Builder `[ARA+MOD]` `Active`
- **Signal patterns:** ARA `Engineering Maturity` dimension has findings indicating team skill gaps; MOD pathways require technologies the team hasn't used before.
- **What the customer gets:** On-demand digital training with 600+ free courses, hands-on labs, learning plans, and certification prep.
- **Link:** https://skillbuilder.aws/
- **Finding to learning path mapping:**
  - `Move to Containers` → Containers Learning Plan, EKS/ECS courses
  - `Move to Managed Databases` → Database Migration learning path, Aurora/DynamoDB courses
  - `Move to Cloud Native` → Serverless Learning Plan, Lambda/API Gateway courses
  - ARA `Observability` gaps → Observability learning path, CloudWatch/X-Ray courses
  - ARA `Authentication & Authorization` gaps → Security Learning Plan, IAM/Cognito courses
  - `Move to AI` / Agentic readiness → Generative AI Learning Plan, Bedrock/Agents courses

### Public Workshop Catalog (Self-Paced) `[ARA+MOD]` `Active`
- **Signal patterns:** MOD findings show specific technology pathways; customer team wants hands-on practice at their own pace.
- **What the customer gets:** Self-paced, hands-on labs covering database migration, containers, serverless, and AI.
- **Link:** https://catalog.workshops.aws/
- **Finding-based workshop mapping:**

| MOD Pathway / ARA Dimension | Relevant Workshop | Self-Paced Link |
|-----------------------------|-------------------|-----------------|
| `Move to Managed Databases` + SQL Server | MMA Workshop (SQL Server track) | https://catalog.workshops.aws/mma-mssql-pg/en-US |
| `Move to Managed Databases` + Oracle | MMA Workshop (Oracle track) | https://catalog.workshops.aws/mma-oracle-pg/en-US |
| `Move to Managed Databases` + Sybase | MMA Workshop (Sybase track) | https://catalog.workshops.aws/mma-sybase-pg |
| `Move to Managed Databases` (any) | Aurora PostgreSQL Immersion Day | https://catalog.workshops.aws/apgimmday |
| `Move to Containers` / `Move to Cloud Native` | EKS Workshop / ECS Workshop | https://catalog.workshops.aws/ (search containers) |
| ARA `Engineering Maturity` gaps | Well-Architected Labs | https://wellarchitectedlabs.com |
| ARA `Observability` gaps | One Observability Workshop | https://catalog.workshops.aws/observability |
| `Move to AI` / `Agent-Ready` | Bedrock Workshop / Agentic AI labs | https://catalog.workshops.aws/ (search bedrock agents) |

---

## AGENT REASONING CHECKLIST

Before finalizing the recommendation list, verify each item:

1. ☐ Does every recommended program meet its qualification criteria based on actual findings?
2. ☐ Have I checked the "DO NOT recommend when" exclusions for each selected program?
3. ☐ Is the total count between 3 and 5 recommendations?
4. ☐ Are recommendations grouped correctly? (`Funded Programs` → `Engagement Models`)
5. ☐ Did I check workload-specific programs (VMware, Windows, Oracle, SAP, Kafka, Mainframe)?
6. ☐ Did I check customer segment (Startup → Activate/IW; ISV → ACP/Booster/SaaS Factory; SMB → self-service options)?
7. ☐ Did I include at least one entry-point program (no prerequisites)?
8. ☐ Are programs sequenced logically? (Assessment → Funding → Execution → Optimization; for ARA anchors: AI DLC → AXE → Innovation EBA)
9. ☐ Did I apply the assessment overlap rule (only ONE assessment per domain)?
10. ☐ Did I apply the EBA vs AML rule (pick one, not both)?
11. ☐ Am I using the correct vocabulary? (ARA: unified severity + profile names; MOD: severity_status + score_rating + pathway names; NEVER internal 1–4 scores)
12. ☐ Is no `Retiring` program included? Is no `Launching` program included unless launch ≤30 days away?
13. ☐ For SMB/startup customers, did I include at least one self-service option?
14. ☐ Is "How to engage" framed from the customer's perspective?

---

*Last updated: June 15, 2026*
*Source: APN Programs Roadmap (Apr 2026) + AWS Highspot (Jun 2026)*
*Total programs indexed: 42 — Tier 1 detailed: 34 (31 from source + 3 ARA agentic anchors); Tier 2 compact: 8*
