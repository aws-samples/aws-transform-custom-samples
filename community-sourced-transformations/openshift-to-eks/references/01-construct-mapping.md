# Construct Mapping: OpenShift to Amazon EKS

> Loaded in Phase 1. Every construct found in the repository resolves to exactly one of three
> classifications. **The classification is fixed here, not decided per run** - leaving it to
> judgement is what produced inconsistent results in the paired Lens.

| Classification | Meaning | What the transformation does |
|---|---|---|
| **MECHANICAL** | A faithful equivalent exists and the conversion is deterministic | Convert it |
| **SCAFFOLD** | Partly automatable; the remainder is a design decision | Emit an incomplete artifact, clearly marked, plus a report item |
| **REPORT-ONLY** | No equivalent, or the substitute changes the guarantee | Do not touch. Report with the recommended path |

---

## MECHANICAL

### `DeploymentConfig` → `apps/v1 Deployment`

| DC field | Deployment equivalent |
|---|---|
| `spec.replicas`, `spec.selector`, `spec.template` | identical |
| `strategy.type: Rolling` | `strategy.type: RollingUpdate` |
| `strategy.type: Recreate` | `strategy.type: Recreate` |
| `strategy.rollingParams.{maxSurge,maxUnavailable}` | `strategy.rollingUpdate.{maxSurge,maxUnavailable}` |
| `spec.selector` (map) | `spec.selector.matchLabels` (the DC form is a bare map; wrap it) |
| `triggers[].ImageChange` | **no equivalent** → report (see below) |
| `strategy.rollingParams.{pre,mid,post}` | **no equivalent** → report + `TODO(migration)` |

Two traps: the DC `selector` is a bare map and `Deployment.spec.selector` needs
`matchLabels`, and `Deployment.spec.selector` is **immutable** after creation, so it must match
the template labels exactly on the first apply.

**Lifecycle hooks** (`pre`/`mid`/`post`) are the reason this is not a pure rename. A `pre` hook
running a database migration becomes an init container or a Job with ordering; a `post` hook
becomes a separate step. Emitting a `Deployment` and dropping the hook silently changes startup
behaviour, so the hook body is copied into the report verbatim with a `TODO(migration)` at the
site.

### `ImageStreamTag` reference → fully qualified registry URI

```yaml
# before: resolves via ImageStream, no registry host, unresolvable off-cluster
image: payments-api:latest

# after
image: <registry>/payments-api:latest
```

`<registry>` comes from `additionalPlanContext.registry`. **If it is absent, do not guess an
account id or region** - emit `TODO(migration): set registry` and a report item. A fabricated
ECR URI fails at pull time in a way that looks like a permissions problem.

Also rewrite: `image-registry.openshift-image-registry.svc:5000/<ns>/<name>` and any
`docker-registry.default.svc` form. Leave `registry.redhat.io` and
`registry.access.redhat.com` references **in place** but report them - they need a pull secret
tied to a Red Hat subscription, which is a licensing decision, not a rewrite.

### `Route` → Gateway API `HTTPRoute`, or `Ingress` + ALB

Driven by `additionalPlanContext.ingress_strategy` (default `gateway-api`).

| Route field | `HTTPRoute` | `Ingress` + ALB |
|---|---|---|
| `spec.host` | `spec.hostnames[]` | `spec.rules[].host` |
| `spec.to.name` + `spec.port` | `backendRefs[].{name,port}` | `backend.service.{name,port}` |
| `spec.path` | `rules[].matches[].path` | `rules[].http.paths[].path` |
| `tls.termination: edge` | Gateway listener TLS terminate | `alb.ingress.kubernetes.io/certificate-arn` |
| `tls.termination: reencrypt` | listener terminate **plus** `BackendTLSPolicy` | `alb.ingress.kubernetes.io/backend-protocol: HTTPS` |
| `tls.termination: passthrough` | listener `mode: Passthrough` | **not expressible on ALB** → NLB, report |
| `insecureEdgeTerminationPolicy: Redirect` | a second listener with a redirect filter | `alb.ingress.kubernetes.io/ssl-redirect` |
| `haproxy.router.openshift.io/timeout` | `spec.rules[].timeouts` | `alb.ingress.kubernetes.io/...` attributes |
| `haproxy.router.openshift.io/balance` | **no equivalent** → report | target-group attribute, report |

**`reencrypt` is the trap.** Converting it to plain `edge` silently drops encryption between the
load balancer and the pod. Nothing fails; the endpoint still answers HTTPS. When the target
cannot preserve re-encryption, **do not downgrade silently** - emit the edge form with a
`TODO(migration)` and a HIGH-risk report entry naming the lost property.

`spec.host` on OpenShift is usually an internal wildcard domain
(`*.apps.ocp-prod.example.internal`) that will not exist on EKS. Carry it into the report as a
DNS action item rather than emitting a hostname that cannot resolve.

### `Template` → Helm chart or Kustomize

`parameters[]` become `values.yaml` entries with the same defaults. `objects[]` become
`templates/`. Two OpenShift-specific behaviours have no Helm equivalent and go to the report:
`generate: expression` (server-side random generation - becomes a Secret the pipeline creates,
never a value committed to `values.yaml`) and `required: true` (Helm has no required-parameter
gate; use a `fail` guard in the template).

### PVC `storageClassName`

| OpenShift class | EKS |
|---|---|
| `gp2`, `gp2-csi`, `gp3-csi`, `thin`, `thin-csi` | `gp3` (EBS CSI) |
| `ocs-storagecluster-cephfs`, `managed-nfs-storage`, anything with `accessModes: [ReadWriteMany]` | `efs` (EFS CSI) |
| `ocs-storagecluster-ceph-rbd` | `gp3` |

**RWX decides, not the class name.** An RWX PVC mapped to `gp3` leaves the second pod
unschedulable, so check `accessModes` before the name. A `StatefulSet` with
`volumeClaimTemplates` also gets a report entry: EBS volumes are **zonal**, so the pod cannot
move across AZs and reattach - that constraint did not exist on the source platform.

### OpenShift-only node labels

`node-role.kubernetes.io/infra`, `node-role.kubernetes.io/worker-*` and
`machine.openshift.io/*` selectors have no EKS counterpart. Rewrite them to labels on the
emitted Karpenter `NodePool` (Phase 3) and keep the selector pointing at the new label. Leaving
the original label produces pods stuck `Pending`, which is loud - but leaving it and NOT
reporting is the failure, because the reader assumes it converted.

---

## SCAFFOLD

### `SecurityContextConstraints` → Pod Security Admission, plus Kyverno only for the residue

Split the SCC's capabilities. **PSA first**; a policy engine only for what PSA cannot express.

| SCC capability | PSA covers it? |
|---|---|
| `runAsUser: RunAsAny` (the `anyuid` case) | **yes** - namespace label `pod-security.kubernetes.io/enforce: baseline` |
| `allowPrivilegedContainer: false`, dropped capabilities, no host namespaces | **yes** - `restricted` |
| `allowPrivilegedContainer: true`, `hostNetwork`, `hostPID` | **yes** - `privileged`, but this is a decision to re-authorise, not to carry over |
| `seLinuxContext: MustRunAs` with a specific level | **no** - needs an admission policy |
| per-field allow-lists, conditional rules, mutation | **no** - needs Kyverno or Gatekeeper |

Emit the namespace labels always. Emit a Kyverno policy **only if** the residue is non-empty,
and say so in the report. A repository using only `anyuid` needs PSA and nothing else; adding a
policy engine there imports a platform component the customer does not need and did not ask for.

### `BuildConfig` → build scaffold

`dockerStrategy` ports almost directly: the `Dockerfile` already exists, so emit a CodeBuild
`buildspec.yml` or a workflow that builds and pushes to ECR.

`sourceStrategy` (S2I) does **not**. The build logic lives in the builder image's
`assemble`/`run` contract, not in the repository. Emit a multi-stage `Dockerfile` skeleton that
copies the `.s2i/assemble` steps in as **comments**, marked `TODO(migration)`, and a report entry
stating that the builder image behaviour has to be reproduced explicitly. Do not attempt to
translate `assemble` into `RUN` lines - it depends on the builder image's environment.

### `PerformanceProfile`, `MachineConfig`, `Tuned` → Karpenter `NodePool` scaffold

Emit a `NodePool` plus `EC2NodeClass` carrying the observed constraints **as comments**, never as
asserted equivalents: isolated/reserved CPU sets, hugepages counts, NUMA policy, sysctl values
from `MachineConfig` ignition files. Mark HIGH risk. Under `eks-auto-mode` the node cannot be
customised at all, so this becomes REPORT-ONLY - state that in the report rather than emitting a
NodePool that will not be honoured.

---

## REPORT-ONLY

| Construct | Why not transformed | What to report |
|---|---|---|
| `ClusterResourceQuota` | No Kubernetes equivalent. Per-namespace quotas give a **sum of maximums**, not a shared pool - substituting them silently removes a ceiling the customer believes still exists | The options ranked by whether they preserve the aggregate: vCluster (yes), a policy engine computing the aggregate at admission (yes, with a race window), per-namespace quotas (**no**, state the gap). Not AAQ - its API is namespaced only |
| `SriovNetwork`, `SriovNetworkNodePolicy`, `NetworkAttachmentDefinition` | Hardware coupling. Multus needs self-managed nodes; SR-IOV needs specific instance types | Whether the target supports it at all, and that under Auto Mode it does not |
| `Subscription`, `CatalogSource`, `OperatorGroup` | Availability is per operator | One entry **per bucket**: community (Helm chart exists), certified-with-upstream (validate parity), openshift-only (blocking) |
| `EgressIP`, `EgressFirewall`, `EgressRouter` | A VPC and firewall design decision | That downstream partners may allow-list the current egress address, so the new NAT address has to be coordinated before cutover |
| `OAuth`, `OAuthClient`, `oauth-proxy` sidecar | EKS has no integrated OAuth server | That application-level auth needs Cognito, an external IdP, or an explicitly deployed proxy |
| `Config` (`imageregistry.operator.openshift.io`) | ECR replaces the component | That a component the customer was operating disappears - a saving, not a risk |
| `Project`, `ProjectRequest` | A Namespace with defaults attached | That the self-service creation path needs replacing; the defaults themselves are covered by the quota, RBAC and NetworkPolicy items |

---

## The portable set: do not touch

These are already correct for EKS and **must come out byte-identical**: `Deployment`, `Service`,
`ConfigMap`, `Secret`, `ServiceAccount`, `Role`, `RoleBinding`, `NetworkPolicy`,
`HorizontalPodAutoscaler`, `PodDisruptionBudget`, probes, `resources`, `topologySpreadConstraints`.

A diff touching any of them is a defect. The paired Lens has a control resource for exactly this
reason: a transformation that rewrites already-portable Kubernetes is doing damage while
appearing productive.
