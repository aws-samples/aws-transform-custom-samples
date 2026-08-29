# Manifest Mapping: Cloud Foundry to Amazon EKS

> Loaded in Phase 1. Every `manifest.yml` field, **and every field that is absent**, resolves to
> exactly one classification. The classification is fixed here, not decided per run.

| Classification | Meaning |
|---|---|
| **MECHANICAL** | The field has a deterministic Kubernetes equivalent. Convert it |
| **SCAFFOLD** | The platform supplied the artifact implicitly. Emit an incomplete, clearly marked stub |
| **REPORT-ONLY** | Not reconstructible from the repository, or the substitute changes the guarantee |

**Absence is a first-class case.** On Cloud Foundry an omitted field meant a platform default
applied. Kubernetes has no such default, so an absent field is usually a finding rather than a
non-event. Each MECHANICAL row below states what absence means.

---

## MECHANICAL

| Field | Kubernetes output | If absent |
|---|---|---|
| `name` | `metadata.name` + the label set | required by CF; if absent the manifest is malformed |
| `instances` | `spec.replicas` | CF default is 1 → emit `replicas: 1` and note it was implicit |
| `memory` | `resources.requests.memory` **and** `limits.memory` | CF default is foundation-specific (commonly 1G) → **do not guess**, emit `TODO` |
| `disk_quota` | `emptyDir.sizeLimit` on a `/tmp` volume | default 1G → emit it, note CF disk was ephemeral |
| `env` | `env[]`; any value matching a credential pattern goes to a Secret stub instead | nothing to do |
| `command` | `command` / `args` | **finding**: the buildpack chose the start command implicitly and it is not in the repo. `TODO` + report |
| `routes` / `domain` + `host` | `Service` + `HTTPRoute` (or `Ingress`) + a DNS action item | `random-route: true` means no stable hostname existed → say so, nothing downstream depends on it |
| `health-check-type: http` + `health-check-http-endpoint` | `readinessProbe` + `livenessProbe` with that path | **finding**: CF defaulted to a TCP port check; Kubernetes has **no** default probe |
| `health-check-type: port` | TCP `readinessProbe` on `containerPort`, marked a **reconstruction** | as above |
| `health-check-invocation-timeout` | `timeoutSeconds` | default 1s |
| `instances` + App Autoscaler rules | `replicas` + an HPA | report that custom-metric rules need a metrics source |
| `Procfile` `web:` | the main container `command` | - |
| `Procfile` non-web process types | **one additional `Deployment` per process type** | easy to lose entirely: the app appears migrated while a background consumer no longer exists |
| `.cfignore` | `.dockerignore` | note that an image build with no `.dockerignore` inflates the context |
| `stack: cflinuxfs3` / `cflinuxfs4` | the builder or base image choice | report that `cflinuxfs3` is EOL |

### `memory` is not a faithful copy

On Cloud Foundry the `memory` value also drove the **buildpack's JVM memory calculation** -
heap, metaspace and thread stack were derived from it. Copying the number into a Kubernetes
`limits.memory` reproduces the ceiling without the derivation, and a JVM that sized itself for a
CF container will exceed it.

Emit the value as both request and limit, **and** emit a HIGH-risk report entry whenever a JVM
language is detected (`pom.xml`, `build.gradle`, a `.jar` artifact). This is the most common cause
of an OOMKill loop after a Cloud Foundry migration, and it looks like a faithful translation.

### There is no CPU field to migrate

Cloud Foundry derived CPU share **from the memory allocation**. The repository therefore contains
no CPU information at all. Emit `resources.requests.cpu` with a `TODO(migration)` and a report
entry stating that the value has to come from observed production usage - not from a guess, and
not omitted, because a pod with no CPU request gets no guarantee.

---

## SCAFFOLD

### Container build

There is no `Dockerfile` in a buildpack-built application, and no image.

| `build_strategy` | Emit | Why |
|---|---|---|
| `buildpacks` (default) | `project.toml` for Paketo / Cloud Native Buildpacks | Closest to the source: Paketo descends from the CF buildpacks and detects the same language signals, so runtime behaviour changes least |
| `dockerfile` | a multi-stage `Dockerfile` skeleton | More control, more behavioural risk: JVM memory calculation, entrypoint and signal handling, and layer caching all become yours |

Detected language and version go in as **comments**, never as asserted values. If the manifest
already uses `docker:`, the image exists and only the deployment wrapper is missing - say so.

### Credential injection

For every entry in `services:`, emit a Secret **stub**:

- the key names the application is likely to read, derived from the service type
- **no values** - a stub with a fabricated connection string is a defect, not a convenience
- a `TODO(migration)` and a report entry naming the AWS service to provision

Flag user-provided services (`cups`) separately: they are arbitrary credentials with no
marketplace analogue, so even the key names are unknown.

### `VCAP_SERVICES` shim

When the application parses `VCAP_SERVICES`, emit a documented option set rather than a choice:

1. **Adapt the code** to read individual env vars or mounted files. Cleanest, and it is a code change.
2. **Project a `VCAP_SERVICES`-shaped JSON** from a Secret as a bridge. No code change, keeps the
   platform-specific shape alive.

Report **the number of distinct call sites** and whether a library (`java-cfenv`,
`spring-cloud-connectors`) mediates them. A single library boundary is a bounded change; inline
parsing in five places is not.

---

## REPORT-ONLY

| Construct | Why not transformed | What to report |
|---|---|---|
| `services:` provisioning | Each binding is a provisioning decision with cost, version and failover implications | The likely AWS counterpart, explicitly **not** asserted as equivalent. A `p-mysql` plan and an RDS instance differ in version, backup policy and failover |
| `cf bind-route-service` | Rate limiting, auth or WAF invisible in the application code | That the control in front of the app disappears silently while traffic keeps flowing |
| `cf run-task`, scheduler bindings | Defined outside the manifest | The most commonly lost part of a CF migration: the web workload migrates and looks healthy while a nightly job no longer runs |
| Application Security Groups (`cf bind-security-group`) | Central egress control the repository does not describe | Both silent consequences: egress that an ASG permitted without the app declaring it, and partners allow-listing the foundation's NAT address |
| Org / space roles | `SpaceDeveloper`, `OrgManager` have no direct RBAC counterpart | That space → namespace is clean but each role becomes a deliberate Role definition |
| Blue-green scripts (`cf rename` + `cf map-route`, `autopilot`) | They encode verification steps between the swap | That a plain RollingUpdate does not have those gates |
| Volume Services (`volume_mounts`) | A storage decision (EBS zonal vs EFS shared), not a translation | That CF gave ephemeral disk only, so an app writing to local disk loses data on every rollout |
| Application code reading `VCAP_*` | Rewriting application logic is out of scope | Every call site, with the file and line |
| Syslog / metrics drains | Platform-side configuration absent from the repository | That an app logging to stdout ports for free, but the drain to the SIEM does not |

---

## The portable set: do not touch

If the repository already contains Kubernetes manifests, a `Dockerfile`, or a Helm chart, they are
**not** in scope for conversion. A repository mid-migration is the common case, and rewriting the
Kubernetes work someone already did is damage disguised as progress.
