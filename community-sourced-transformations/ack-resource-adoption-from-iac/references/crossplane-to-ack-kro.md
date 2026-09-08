# Crossplane to ACK + kro Mapping

Crossplane is the fourth IaC flavor this definition reads. It differs from the other three in
one decisive way: **Crossplane resources are already Kubernetes objects**, so the conversion
is not "parse a foreign language" - it is a re-projection between two Kubernetes resource
models. Two layers, two targets:

| Crossplane layer | Target | Why |
|---|---|---|
| Managed Resources (MRs - `*.upbound.io`, `*.aws.crossplane.io`) | **ACK manifests** with adoption annotations | An MR is a declaration of ONE AWS resource - same class as a `aws_s3_bucket` block |
| `Composition` + `CompositeResourceDefinition` (XRD) | **kro `ResourceGraphDefinition`** | A Composition is a composition unit - same class as a Terraform module or CFN nested stack |
| Claim / XR instances | **kro instance CRs** | The per-instantiation values |

## 1. Managed Resource → ACK manifest

Input (Crossplane provider-aws-s3):

```yaml
apiVersion: s3.aws.upbound.io/v1beta1
kind: Bucket
metadata:
  name: reports
  annotations:
    crossplane.io/external-name: acme-reports-prod
spec:
  deletionPolicy: Orphan
  forProvider:
    region: us-east-1
    tags:
      Team: analytics
  providerConfigRef:
    name: default
```

Output (`ack-adoption/s3-bucket-reports.yaml`):

```yaml
apiVersion: s3.services.k8s.aws/v1alpha1
kind: Bucket
metadata:
  name: reports
  annotations:
    services.k8s.aws/adoption-policy: "adopt-or-create"
    services.k8s.aws/deletion-policy: "retain"
spec:
  name: acme-reports-prod   # from crossplane.io/external-name
  tagging:
    tagSet:
      - key: Team
        value: analytics
```

Mapping rules:

1. **`crossplane.io/external-name` IS the physical identifier.** This is the highest-fidelity
   identifier source of any IaC flavor - Crossplane stores the deployed AWS name/ID there.
   Use it for the ACK name field, and for `adoption-fields` when the Kind requires one.
   An MR **without** external-name (never reconciled, or name == metadata.name convention)
   falls back to the usual resolution order; if unresolved, `TODO(discovery)` as usual.
2. **`spec.forProvider.*` maps field-by-field to the ACK spec** via the same service table in
   `iac-to-ack-mapping.md` (upbound provider field names are close to the AWS API, like ACK's).
   A `forProvider` field with no ACK equivalent goes to the report, never dropped silently.
3. **`deletionPolicy: Orphan` vs `Delete`:** the ACK output ALWAYS carries
   `deletion-policy: retain` (non-negotiable safety rule of this definition). When the source
   MR had `deletionPolicy: Delete`, add a report note: the adoption CHANGES delete semantics,
   deliberately, and decommissioning is a manual step.
4. **`providerConfigRef` is REPORT-ONLY.** Crossplane centralizes credentials per
   ProviderConfig; ACK uses per-controller IRSA/Pod Identity. The report's prerequisite
   checklist covers the ACK side; the ProviderConfig itself has no output artifact.
5. **`managementPolicies` (Observe-only MRs)** - an MR with `["Observe"]` is Crossplane's
   read-only import. It maps cleanly: adoption with `adopt-or-create` is the ACK moral
   equivalent. Note it in the report as an intent match.
6. **References (`*Ref` / `*Selector` fields, e.g. `vpcIdRef`)**: inside a Composition they
   become kro CEL (`${vpc.status.vpcID}`); on flat MRs resolve the referenced MR's
   external-name; if the referenced object is not in the repository, `TODO(discovery)`.

## 2. Composition + XRD → kro ResourceGraphDefinition

Input (abridged):

```yaml
apiVersion: apiextensions.crossplane.io/v1
kind: CompositeResourceDefinition
metadata:
  name: xqueues.platform.example.org
spec:
  group: platform.example.org
  names: { kind: XQueue, plural: xqueues }
  claimNames: { kind: Queue, plural: queues }
  versions:
    - name: v1alpha1
      schema:
        openAPIV3Schema:
          properties:
            spec:
              properties:
                queueName: { type: string }
                maxReceiveCount: { type: integer, default: 5 }
---
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: queue-with-dlq
spec:
  compositeTypeRef: { apiVersion: platform.example.org/v1alpha1, kind: XQueue }
  resources:
    - name: dlq
      base:
        apiVersion: sqs.aws.upbound.io/v1beta1
        kind: Queue
        spec: { forProvider: { region: us-east-1 } }
      patches:
        - fromFieldPath: spec.queueName
          toFieldPath: metadata.annotations[crossplane.io/external-name]
          transforms:
            - type: string
              string: { fmt: "%s-dlq" }
    - name: queue
      base: { ... }
```

Output: one RGD in the exact shape of `kro-patterns.md`, with the translation table:

| Crossplane construct | kro RGD construct |
|---|---|
| XRD `spec.versions[].schema` properties | `spec.schema.spec` simpleSchema fields (`string`, `integer \| default=5`) |
| XRD `claimNames` | the RGD-generated kind is namespaced by default - claims map 1:1 to instance CRs |
| `Composition.spec.resources[].base` (an MR) | `resources[].template` - the MR converted to its **ACK** Kind per section 1, adoption annotations included |
| patch `fromFieldPath: spec.x` | CEL `${schema.spec.x}` at the patched location |
| patch between siblings (`ToCompositeFieldPath` then `FromCompositeFieldPath` relay) | direct CEL sibling reference `${dlq.status.ackResourceMetadata.arn}` - kro does not need the composite as a relay |
| `transforms: string fmt "%s-dlq"` | CEL string concatenation `${schema.spec.queueName}-dlq` |
| `transforms: map` / `math` / non-trivial chains | **REPORT-ONLY** - emit the resource with a `TODO(migration)` at the patched field and a report entry quoting the transform |
| `connectionDetails` | **REPORT-ONLY** - kro has no connection-secret machinery; the report names each detail and the consuming workload pattern (read from ACK status / field export) |
| `mode: Pipeline` (composition functions) | **REPORT-ONLY, whole Composition** - a function is arbitrary code; degrade the entire unit to guidance, never partially translate it |
| Multiple Compositions for one XRD (`compositionRef`/`compositionSelector`) | one RGD per Composition, named after the Composition; report note that instance CRs must target the right RGD kind |

Claim instances (namespaced `Queue` objects) become kro instance CRs with the same field
values - one per claim found in the repository.

## 3. Detection signals (Phase 0)

```text
Crossplane flavor present when any of:
  apiVersion: apiextensions.crossplane.io/*      (XRD, Composition)
  apiVersion: *.upbound.io/*                     (upbound provider MRs)
  apiVersion: *.aws.crossplane.io/*              (classic provider MRs)
  apiVersion: pkg.crossplane.io/*                (Provider/Configuration packages - REPORT-ONLY)
```

`pkg.crossplane.io` objects (Provider, Configuration, Function) are platform bootstrap - the
same class as Flux's `flux-system/`: reported under prerequisites, never converted.

## 4. What Crossplane has that the other flavors do not (report obligations)

1. **Live-cluster state is authoritative but out of scope.** The repository may not contain
   claims that exist only in the cluster. The report must state that the inventory covers the
   REPOSITORY, and give the discovery command (`kubectl get managed -o yaml`) for a live diff.
2. **Two controllers fighting:** if Crossplane keeps running with `deletionPolicy: Delete`
   after ACK adopts, both controllers reconcile the same AWS resource. The report's cutover
   section must instruct pausing Crossplane (`crossplane.io/paused: "true"` annotation) before
   applying, symmetric to the Flux-vs-Argo ownership rule.
