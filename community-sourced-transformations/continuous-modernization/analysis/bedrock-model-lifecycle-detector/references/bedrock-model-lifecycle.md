# Amazon Bedrock Model Lifecycle (Legacy and EOL models)

Snapshot date: 2026-11-03.

Point-in-time snapshot of the Amazon Bedrock model lifecycle, used to assign
severity, plus the replacement for each Legacy, EOL, and retired model. It covers
every model provider on Amazon Bedrock and was taken on the snapshot date from
two lifecycle documentation pages:

- https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle.html
- https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle-legacy.html

and from the Amazon Bedrock model cards: the "Models at a glance" index
https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html and every
model card it links to. The lifecycle pages name no replacement models; the
model cards give each model's launch date, lifecycle, model IDs per endpoint, and
inference profile prefixes.

Models announced as Legacy or EOL after the snapshot date are not listed.

## Lifecycle states

- `eol` - the EOL date has passed. The model has been removed from the listed
  Regions and requests to it fail there.
- `legacy` - the model has an announced EOL date that has not passed yet. It is
  still callable by existing customers, but new customers cannot use it, existing
  customers may lose access after 15 days of inactivity, and no new Provisioned
  Throughput or fine-tuning is allowed. From the public extended access start
  date until the EOL date, the provider may charge higher pricing.

The Regions column lists only the Regions covered by the announced EOL date. A
model can stay Active in other Regions.

A model ID can have several rows: one per Region group with a different date, or
both a `legacy` row and an `eol` row. When rows for the same model ID disagree,
the worst state wins (`eol` over `legacy`, then the earliest EOL date).

## Matching rules

1. Strip a leading cross-region inference profile prefix before lookup, such as
   `us.`, `us-gov.`, `eu.`, `apac.`, `jp.`, `au.`, `in.`, `ca.`, or `global.`. For
   example `us.meta.llama3-3-70b-instruct-v1:0` is looked up as
   `meta.llama3-3-70b-instruct-v1:0`.
2. For an ARN, take the final path segment after `foundation-model/`,
   `inference-profile/`, `provisioned-model/`, or `custom-model/` when that
   segment holds a model ID, then apply rule 1. In
   `arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`
   the model ID is `anthropic.claude-3-sonnet-20240229-v1:0`. Application
   inference profile ARNs and other ARNs with opaque IDs cannot be resolved from
   code alone.
3. Strip framework prefixes such as LiteLLM `bedrock/`, `bedrock/converse/`, and
   `bedrock/invoke/`.
4. A reference matches exactly one model ID, the first of these that exists in
   either table:
   - the ID that equals the reference after dropping a context-window suffix
     after the version, such as the `:200k` in `:0:200k`
     (`anthropic.claude-3-haiku-20240307-v1:0:200k` matches
     `anthropic.claude-3-haiku-20240307-v1:0`);
   - for a reference without a trailing `:N` version, the ID that equals it
     plus a `:N` version, taking the lowest `N` when several do
     (`anthropic.claude-3-haiku-20240307-v1` matches
     `anthropic.claude-3-haiku-20240307-v1:0`, and `amazon.nova-reel-v1`
     matches `amazon.nova-reel-v1:0`);
   - for a reference with version `:0`, the ID that equals it without the
     version (`anthropic.claude-v2:0:100k` matches `anthropic.claude-v2`).

   A reference with any other explicit version matches only the ID with that
   version: `amazon.nova-reel-v1:1` never matches `amazon.nova-reel-v1:0`, and
   `anthropic.claude-v2:1` never matches `anthropic.claude-v2`.
5. The bedrock-mantle variant IDs listed in the table, such as `deepseek.v3.1`,
   match their own row.
6. A model ID that is in neither the Legacy and EOL models table nor the
   retired models table is not a finding.

## Caveat

This file is a point-in-time snapshot. Lifecycle states move one way: `legacy`
becomes `eol`. If the snapshot date is older than the analysis date, re-derive
`eol` or `legacy` from each row's EOL date and the analysis date rather than
trusting the Lifecycle column. Never downgrade a classification because a model
is still callable: a model can be callable and still have an announced EOL date,
or be callable in a Region not listed for it.

## Model families and replacements

A model family groups the models of one provider whose names differ only by
version, date, size, or variant tokens. For example Claude 3.5 Sonnet, Claude
Sonnet 4.5, and Claude Sonnet 5.5 are the Claude Sonnet family, and Gemma 3 12B
IT and Gemma 4 31B are the Gemma family. The family is derived from the model
name: parenthesized text, version numbers (`3.5`, `v2`, `M2.1`), size tokens
(`70B`, `A3B`, `8x7B`), and variant tokens (`Instruct`, `IT`, `PT`, `BF16`) are
dropped, and the remaining words are compared without the words of the provider
name. Families never span providers. A Legacy, EOL, or retired model is named
by its own model card when a card lists its model ID, so that both sides use
the model card naming (if the lifecycle page says Llama 3.2 11B Instruct and the
card says Llama 3.2 11B Vision Instruct, the card name is used), and by the
lifecycle page or the retired models table otherwise. The Model family column
shows the family label of the family's latest Active model (provider words
included, for example Qwen Coder Next), or the model's own label when the family
has no Active model.

Because size and modality are not part of the family, the latest Active model
can be much smaller or larger than the model it replaces, or lack an input
modality such as images. The Active models table lists every Active model of
the family with its Modalities for choosing a closer one.

- The replacement for a Legacy, EOL, or retired model is the Active model in the
  same family with the latest launch date.
- A model counts as Active only if its model card says Active and its model ID is
  in neither the Legacy and EOL models table nor the retired models table.
- When several Active models in the family share the latest launch date, each
  gets its own row.
- A replacement model has one row per endpoint (`bedrock-runtime` or
  `bedrock-mantle`), each with the model ID for that endpoint. Prefer the row
  whose endpoint matches the one the code calls. When no row is on that
  endpoint, or the row lacks the inference profile geography the reference
  needs (for example `jp` or `us-gov`), an older model of the same family in
  the Active models table may have it.
- The "Inference profile prefixes" column lists the cross-region inference
  profile prefixes (for example `us`, `eu`, `global`) the replacement supports on
  that endpoint. `-` means none: call the model ID directly. When prefixes are
  listed, the model may accept on-demand requests only through an inference
  profile (for example `us.<model ID>` or `global.<model ID>`); a request with
  the base model ID can then fail with a ValidationException.
- A row with replacement `-` means no Active model in that family is listed in
  the model cards. Check the Active models table for a model of the same provider
  instead of guessing.

## Family overrides

The name-based family is wrong for the Legacy, EOL, and retired models below, so
the Replacement models table uses the family listed here instead. The family
label is normalized the same way as model names (for example `Qwen3 Coder Next`
is the family Qwen Coder Next of provider Qwen), and an override applies to that
model ID only.

| Model ID | Family |
|---|---|
| `anthropic.claude-instant-v1` | Claude Haiku |
| `anthropic.claude-v2` | Claude Sonnet |
| `anthropic.claude-v2:1` | Claude Sonnet |
| `moonshot.kimi-k2-thinking` | Kimi |
| `moonshotai.kimi-k2-thinking` | Kimi |
| `qwen.qwen3-coder-30b-a3b-v1:0` | Qwen3 Coder Next |
| `qwen.qwen3-coder-30b-a3b-instruct` | Qwen3 Coder Next |
| `qwen.qwen3-coder-480b-a35b-v1:0` | Qwen3 Coder Next |
| `qwen.qwen3-coder-480b-a35b-instruct` | Qwen3 Coder Next |

## Retired models no longer listed in the docs

AWS removes models from the lifecycle pages some time after their EOL date. The
models below are EOL but were no longer listed on the lifecycle pages on the
snapshot date. Treat each as `eol` in every Region, with `eol_date` and
`regions` recorded as `-`.

| Model ID | Provider | Model name | Lifecycle |
|---|---|---|---|
| `anthropic.claude-instant-v1` | Anthropic | Claude Instant | eol |
| `anthropic.claude-v2` | Anthropic | Claude 2 | eol |
| `anthropic.claude-v2:1` | Anthropic | Claude 2.1 | eol |
| `anthropic.claude-3-opus-20240229-v1:0` | Anthropic | Claude 3 Opus | eol |

## Legacy and EOL models

From the two lifecycle pages on the snapshot date: 62 rows, 56 distinct model
IDs, 14 eol rows, 48 legacy rows. The Lifecycle column is the state on the
snapshot date.

| Model ID | Provider | Model name | Lifecycle | Regions | Legacy date | EOL date | Public extended access start |
|---|---|---|---|---|---|---|---|
| `ai21.jamba-1-5-large-v1:0` | AI21 Labs | Jamba 1.5 Large | legacy | us-east-1 | 2026-05-26 | 2026-11-26 | 2026-08-26 |
| `ai21.jamba-1-5-mini-v1:0` | AI21 Labs | Jamba 1.5 Mini | legacy | us-east-1 | 2026-05-26 | 2026-11-26 | 2026-08-26 |
| `amazon.nova-canvas-v1:0` | Amazon | Nova Canvas | eol | ap-northeast-1, eu-west-1, us-east-1 | 2026-03-30 | 2026-09-30 | - |
| `amazon.nova-reel-v1:0` | Amazon | Nova Reel | eol | ap-northeast-1, eu-west-1, us-east-1 | 2026-03-30 | 2026-09-30 | - |
| `amazon.nova-reel-v1:1` | Amazon | Nova Reel | eol | us-east-1 | 2026-03-30 | 2026-09-30 | - |
| `amazon.nova-sonic-v1:0` | Amazon | Nova Sonic | eol | ap-northeast-1, eu-north-1, us-east-1 | 2026-03-13 | 2026-09-14 | - |
| `anthropic.claude-3-5-sonnet-20240620-v1:0` | Anthropic | Claude 3.5 Sonnet | legacy | ap-northeast-2, ap-south-1, ap-southeast-1 | 2026-10-10 | 2026-11-13 | 2026-10-10 |
| `anthropic.claude-3-5-sonnet-20241022-v2:0` | Anthropic | Claude 3.5 Sonnet v2 | legacy | ap-northeast-2, ap-south-1, ap-southeast-1 | 2026-10-10 | 2026-11-13 | 2026-10-10 |
| `anthropic.claude-3-7-sonnet-20250219-v1:0` | Anthropic | Claude 3.7 Sonnet | legacy | ap-south-1, eu-west-2 | 2026-10-10 | 2026-11-13 | 2026-10-10 |
| `anthropic.claude-3-haiku-20240307-v1:0` | Anthropic | Claude 3 Haiku | eol | ap-northeast-1, ap-southeast-2, eu-central-1, eu-west-1, eu-west-2, eu-west-3, us-east-1, us-east-2, us-west-2 | 2026-03-10 | 2026-09-10 | 2026-06-10 |
| `anthropic.claude-3-haiku-20240307-v1:0` | Anthropic | Claude 3 Haiku | eol | us-gov-east-1, us-gov-west-1 | 2026-03-10 | 2026-09-10 | 2026-06-10 |
| `anthropic.claude-3-haiku-20240307-v1:0` | Anthropic | Claude 3 Haiku | legacy | ap-northeast-2, ap-south-1, ap-southeast-1 | 2026-10-10 | 2026-11-13 | 2026-10-10 |
| `anthropic.claude-3-haiku-20240307-v1:0` | Anthropic | Claude 3 Haiku | legacy | eu-central-2, sa-east-1 | 2026-10-13 | 2026-11-13 | 2026-10-13 |
| `anthropic.claude-3-haiku-20240307-v1:0` | Anthropic | Claude 3 Haiku | legacy | ca-central-1 | 2026-10-15 | 2026-11-27 | 2026-10-15 |
| `anthropic.claude-3-sonnet-20240229-v1:0` | Anthropic | Claude 3 Sonnet | legacy | ap-south-1, ap-southeast-1, eu-west-2 | 2026-10-10 | 2026-11-13 | 2026-10-10 |
| `anthropic.claude-3-sonnet-20240229-v1:0` | Anthropic | Claude 3 Sonnet | legacy | sa-east-1 | 2026-10-13 | 2026-11-13 | 2026-10-13 |
| `anthropic.claude-3-sonnet-20240229-v1:0` | Anthropic | Claude 3 Sonnet | legacy | ca-central-1 | 2026-10-15 | 2026-11-27 | 2026-10-15 |
| `anthropic.claude-opus-4-1-20250805-v1:0` | Anthropic | Claude Opus 4.1 | legacy | us-east-1, us-east-2, us-west-2 | 2026-07-08 | 2027-01-08 | 2026-10-08 |
| `anthropic.claude-sonnet-4-20250514-v1:0` | Anthropic | Claude Sonnet 4 | eol | ap-northeast-1, eu-central-1, eu-north-1, eu-south-1, eu-south-2, eu-west-1, eu-west-3, us-east-1, us-east-2, us-west-1, us-west-2, ap-east-2, ap-northeast-2, ap-northeast-3, ap-south-1, ap-south-2, ap-southeast-1, ap-southeast-2, ap-southeast-3, ap-southeast-4, ap-southeast-5, ap-southeast-7, il-central-1 | 2026-04-14 | 2026-10-14 | 2026-07-14 |
| `anthropic.claude-sonnet-4-5-20250929-v1:0` | Anthropic | Claude Sonnet 4.5 | legacy | af-south-1, ap-east-2, ap-northeast-1, ap-northeast-2, ap-northeast-3, ap-south-1, ap-south-2, ap-southeast-1, ap-southeast-2, ap-southeast-3, ap-southeast-4, ap-southeast-5, ap-southeast-6, ap-southeast-7, ca-central-1, ca-west-1, eu-central-1, eu-central-2, eu-north-1, eu-south-1, eu-south-2, eu-west-1, eu-west-2, eu-west-3, il-central-1, mx-central-1, sa-east-1, us-east-1, us-east-2, us-west-1, us-west-2 | 2026-10-08 | 2027-04-08 | 2027-01-08 |
| `cohere.command-r-plus-v1:0` | Cohere | Command R+ | eol | us-east-1, us-west-2 | 2026-02-19 | 2026-08-19 | 2026-05-19 |
| `cohere.command-r-v1:0` | Cohere | Command R | eol | us-east-1, us-west-2 | 2026-02-19 | 2026-08-19 | 2026-05-19 |
| `deepseek.r1-v1:0` | DeepSeek | DeepSeek-R1 | legacy | us-east-1, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `deepseek.v3-v1:0` | DeepSeek | DeepSeek-V3.1 (bedrock-runtime) | legacy | ap-northeast-1, ap-south-1, ap-southeast-2, ap-southeast-3, eu-north-1, eu-west-2, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `deepseek.v3.1` | DeepSeek | DeepSeek-V3.1 (bedrock-mantle) | legacy | ap-northeast-1, ap-south-1, ap-southeast-2, ap-southeast-3, eu-north-1, eu-west-2, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `google.gemma-3-12b-it` | Google | Gemma 3 12B IT | legacy | ap-northeast-1, ap-south-1, ap-southeast-2, eu-south-1, eu-west-1, eu-west-2, sa-east-1, us-east-1, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `google.gemma-3-27b-it` | Google | Gemma 3 27B PT | legacy | ap-northeast-1, ap-south-1, ap-southeast-2, eu-south-1, eu-west-1, eu-west-2, sa-east-1, us-east-1, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `google.gemma-3-4b-it` | Google | Gemma 3 4B IT | legacy | ap-northeast-1, ap-south-1, ap-southeast-2, eu-south-1, eu-west-1, eu-west-2, sa-east-1, us-east-1, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `meta.llama3-1-405b-instruct-v1:0` | Meta | Llama 3.1 405B Instruct | eol | us-east-2, us-west-2 | 2026-01-07 | 2026-07-07 | 2026-04-07 |
| `meta.llama3-1-70b-instruct-v1:0` | Meta | Llama 3.1 70B Instruct | legacy | us-east-1, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `meta.llama3-1-8b-instruct-v1:0` | Meta | Llama 3.1 8B Instruct | legacy | us-east-1, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `meta.llama3-2-11b-instruct-v1:0` | Meta | Llama 3.2 11B Instruct | eol | us-east-1, us-east-2, us-west-2 | 2026-01-07 | 2026-07-07 | 2026-04-07 |
| `meta.llama3-2-1b-instruct-v1:0` | Meta | Llama 3.2 1B Instruct | eol | eu-central-1, eu-west-1, eu-west-3, us-east-1, us-east-2, us-west-2 | 2026-01-07 | 2026-07-07 | 2026-04-07 |
| `meta.llama3-2-3b-instruct-v1:0` | Meta | Llama 3.2 3B Instruct | eol | eu-central-1, eu-west-1, eu-west-3, us-east-1, us-east-2, us-west-2 | 2026-01-07 | 2026-07-07 | 2026-04-07 |
| `meta.llama3-2-90b-instruct-v1:0` | Meta | Llama 3.2 90B Instruct | eol | us-east-1, us-east-2, us-west-2 | 2026-01-07 | 2026-07-07 | 2026-04-07 |
| `meta.llama3-3-70b-instruct-v1:0` | Meta | Llama 3.3 70B Instruct | legacy | us-east-1, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `meta.llama3-70b-instruct-v1:0` | Meta | Llama 3 70B Instruct | legacy | ap-south-1, ca-central-1, eu-west-2, us-east-1, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `meta.llama3-8b-instruct-v1:0` | Meta | Llama 3 8B Instruct | legacy | ap-south-1, ca-central-1, eu-west-2, us-east-1, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `meta.llama4-maverick-17b-instruct-v1:0` | Meta | Llama 4 Maverick 17B Instruct | legacy | us-east-1, us-east-2, us-west-1, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `meta.llama4-scout-17b-instruct-v1:0` | Meta | Llama 4 Scout 17B Instruct | legacy | us-east-1, us-east-2, us-west-1, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `minimax.minimax-m2` | MiniMax | MiniMax M2 | legacy | ap-northeast-1, ap-south-1, ap-southeast-2, eu-south-1, eu-west-1, eu-west-2, sa-east-1, us-east-1, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `minimax.minimax-m2.1` | MiniMax | MiniMax M2.1 | legacy | ap-northeast-1, ap-south-1, ap-southeast-2, ap-southeast-3, eu-central-1, eu-north-1, eu-south-1, eu-west-1, eu-west-2, sa-east-1, us-east-1, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `mistral.devstral-2-123b` | Mistral AI | Devstral 2 123B | legacy | ap-northeast-1, ap-south-1, ap-southeast-2, ap-southeast-3, eu-central-1, eu-north-1, eu-south-1, eu-west-1, eu-west-2, sa-east-1, us-east-1, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `mistral.mistral-7b-instruct-v0:2` | Mistral AI | Mistral 7B Instruct | legacy | ap-south-1, ap-southeast-2, ca-central-1, eu-west-1, eu-west-2, eu-west-3, sa-east-1, us-east-1, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `mistral.mixtral-8x7b-instruct-v0:1` | Mistral AI | Mixtral 8x7B Instruct | legacy | ap-south-1, ap-southeast-2, ca-central-1, eu-west-1, eu-west-2, eu-west-3, sa-east-1, us-east-1, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `mistral.voxtral-mini-3b-2507` | Mistral AI | Voxtral Mini 3B 2507 | legacy | ap-northeast-1, ap-south-1, ap-southeast-2, eu-south-1, eu-west-1, eu-west-2, sa-east-1, us-east-1, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `mistral.voxtral-small-24b-2507` | Mistral AI | Voxtral Small 24B 2507 | legacy | ap-northeast-1, ap-south-1, ap-southeast-2, eu-south-1, eu-west-1, eu-west-2, sa-east-1, us-east-1, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `moonshot.kimi-k2-thinking` | Moonshot AI | Kimi K2 Thinking (bedrock-runtime) | legacy | ap-northeast-1, ap-south-1, ap-southeast-2, sa-east-1, us-east-1, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `moonshotai.kimi-k2-thinking` | Moonshot AI | Kimi K2 Thinking (bedrock-mantle) | legacy | ap-northeast-1, ap-south-1, ap-southeast-2, sa-east-1, us-east-1, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `nvidia.nemotron-nano-12b-v2` | NVIDIA | NVIDIA Nemotron Nano 12B v2 VL BF16 | legacy | ap-northeast-1, ap-south-1, ap-southeast-2, eu-south-1, eu-west-1, eu-west-2, sa-east-1, us-east-1, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `nvidia.nemotron-nano-9b-v2` | NVIDIA | NVIDIA Nemotron Nano 9B v2 | legacy | ap-northeast-1, ap-south-1, ap-southeast-2, eu-south-1, eu-west-1, eu-west-2, sa-east-1, us-east-1, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `qwen.qwen3-coder-30b-a3b-instruct` | Qwen | Qwen3-Coder-30B-A3B-Instruct (bedrock-mantle) | legacy | ap-northeast-1, ap-south-1, ap-southeast-2, ap-southeast-3, eu-central-1, eu-north-1, eu-south-1, eu-west-1, eu-west-2, sa-east-1, us-east-1, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `qwen.qwen3-coder-30b-a3b-v1:0` | Qwen | Qwen3-Coder-30B-A3B-Instruct (bedrock-runtime) | legacy | ap-northeast-1, ap-south-1, ap-southeast-2, ap-southeast-3, eu-central-1, eu-north-1, eu-south-1, eu-west-1, eu-west-2, sa-east-1, us-east-1, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `qwen.qwen3-coder-480b-a35b-instruct` | Qwen | Qwen3 Coder 480B A35B Instruct (bedrock-mantle) | legacy | ap-northeast-1, ap-south-1, ap-southeast-2, ap-southeast-3, eu-north-1, eu-west-2, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `qwen.qwen3-coder-480b-a35b-v1:0` | Qwen | Qwen3 Coder 480B A35B Instruct (bedrock-runtime) | legacy | ap-northeast-1, ap-south-1, ap-southeast-2, ap-southeast-3, eu-north-1, eu-west-2, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `twelvelabs.marengo-embed-2-7-v1:0` | TwelveLabs | Marengo Embed v2.7 | legacy | ap-northeast-2, eu-west-1, us-east-1 | 2026-05-29 | 2026-11-30 | 2026-08-29 |
| `twelvelabs.marengo-embed-3-0-v1:0` | TwelveLabs | Marengo Embed 3.0 | legacy | ap-northeast-2 | 2026-09-22 | 2027-03-22 | - |
| `twelvelabs.pegasus-1-2-v1:0` | TwelveLabs | Pegasus v1.2 | legacy | af-south-1, ap-east-2, ap-northeast-1, ap-northeast-2, ap-northeast-3, ap-south-1, ap-south-2, ap-southeast-1, ap-southeast-2, ap-southeast-3, ap-southeast-4, ap-southeast-5, ap-southeast-7, ca-central-1, ca-west-1, eu-central-1, eu-central-2, eu-north-1, eu-south-1, eu-south-2, eu-west-1, eu-west-2, eu-west-3, il-central-1, mx-central-1, sa-east-1, us-east-1, us-east-2, us-west-1, us-west-2 | 2026-09-22 | 2027-03-22 | - |
| `writer.palmyra-x4-v1:0` | Writer | Palmyra X4 | legacy | us-east-1, us-east-2, us-west-1, us-west-2 | 2026-09-09 | 2027-03-09 | - |
| `writer.palmyra-x5-v1:0` | Writer | Palmyra X5 | legacy | us-east-1, us-east-2, us-west-1, us-west-2 | 2026-09-21 | 2027-03-21 | - |
| `zai.glm-4.7` | Z.AI | GLM 4.7 | legacy | ap-northeast-1, ap-south-1, ap-southeast-2, ap-southeast-3, eu-north-1, eu-west-2, sa-east-1, us-east-1, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |
| `zai.glm-4.7-flash` | Z.AI | GLM 4.7 Flash | legacy | ap-northeast-1, ap-south-1, ap-southeast-2, ap-southeast-3, eu-central-1, eu-north-1, eu-south-1, eu-west-1, eu-west-2, sa-east-1, us-east-1, us-east-2, us-west-2 | 2026-09-30 | 2027-03-30 | TBA |

## Replacement models and Active models

From 138 model cards (98 Active model IDs) and the lifecycle data above, on the
snapshot date: 88 replacement rows for 60 Legacy, EOL, and retired model IDs, 30
of them with no Active model in the family. See "Model families and
replacements" for how to read these tables.

### Replacement models

| Model ID | Model family | Replacement model ID | Replacement endpoint | Replacement name | Replacement launch date | Inference profile prefixes |
|---|---|---|---|---|---|---|
| `ai21.jamba-1-5-large-v1:0` | Jamba Large | - | - | - | - | - |
| `ai21.jamba-1-5-mini-v1:0` | Jamba Mini | - | - | - | - | - |
| `amazon.nova-canvas-v1:0` | Nova Canvas | - | - | - | - | - |
| `amazon.nova-reel-v1:0` | Nova Reel | - | - | - | - | - |
| `amazon.nova-reel-v1:1` | Nova Reel | - | - | - | - | - |
| `amazon.nova-sonic-v1:0` | Nova Sonic | `amazon.nova-2-5-sonic` | bedrock-runtime | Nova 2.5 Sonic | 2026-10-05 | - |
| `anthropic.claude-3-5-sonnet-20240620-v1:0` | Claude Sonnet | `anthropic.claude-sonnet-5-5` | bedrock-runtime | Claude Sonnet 5.5 | 2026-09-28 | us, eu, au, global |
| `anthropic.claude-3-5-sonnet-20240620-v1:0` | Claude Sonnet | `anthropic.claude-sonnet-5-5` | bedrock-mantle | Claude Sonnet 5.5 | 2026-09-28 | - |
| `anthropic.claude-3-5-sonnet-20241022-v2:0` | Claude Sonnet | `anthropic.claude-sonnet-5-5` | bedrock-runtime | Claude Sonnet 5.5 | 2026-09-28 | us, eu, au, global |
| `anthropic.claude-3-5-sonnet-20241022-v2:0` | Claude Sonnet | `anthropic.claude-sonnet-5-5` | bedrock-mantle | Claude Sonnet 5.5 | 2026-09-28 | - |
| `anthropic.claude-3-7-sonnet-20250219-v1:0` | Claude Sonnet | `anthropic.claude-sonnet-5-5` | bedrock-runtime | Claude Sonnet 5.5 | 2026-09-28 | us, eu, au, global |
| `anthropic.claude-3-7-sonnet-20250219-v1:0` | Claude Sonnet | `anthropic.claude-sonnet-5-5` | bedrock-mantle | Claude Sonnet 5.5 | 2026-09-28 | - |
| `anthropic.claude-3-haiku-20240307-v1:0` | Claude Haiku | `anthropic.claude-haiku-5-5` | bedrock-runtime | Claude Haiku 5.5 | 2026-10-07 | us, ca, eu, au, jp, global |
| `anthropic.claude-3-haiku-20240307-v1:0` | Claude Haiku | `anthropic.claude-haiku-5-5` | bedrock-mantle | Claude Haiku 5.5 | 2026-10-07 | - |
| `anthropic.claude-3-opus-20240229-v1:0` | Claude Opus | `anthropic.claude-opus-5-5` | bedrock-runtime | Claude Opus 5.5 | 2026-09-22 | us, eu, au, jp, global |
| `anthropic.claude-3-opus-20240229-v1:0` | Claude Opus | `anthropic.claude-opus-5-5` | bedrock-mantle | Claude Opus 5.5 | 2026-09-22 | - |
| `anthropic.claude-3-sonnet-20240229-v1:0` | Claude Sonnet | `anthropic.claude-sonnet-5-5` | bedrock-runtime | Claude Sonnet 5.5 | 2026-09-28 | us, eu, au, global |
| `anthropic.claude-3-sonnet-20240229-v1:0` | Claude Sonnet | `anthropic.claude-sonnet-5-5` | bedrock-mantle | Claude Sonnet 5.5 | 2026-09-28 | - |
| `anthropic.claude-instant-v1` | Claude Haiku | `anthropic.claude-haiku-5-5` | bedrock-runtime | Claude Haiku 5.5 | 2026-10-07 | us, ca, eu, au, jp, global |
| `anthropic.claude-instant-v1` | Claude Haiku | `anthropic.claude-haiku-5-5` | bedrock-mantle | Claude Haiku 5.5 | 2026-10-07 | - |
| `anthropic.claude-opus-4-1-20250805-v1:0` | Claude Opus | `anthropic.claude-opus-5-5` | bedrock-runtime | Claude Opus 5.5 | 2026-09-22 | us, eu, au, jp, global |
| `anthropic.claude-opus-4-1-20250805-v1:0` | Claude Opus | `anthropic.claude-opus-5-5` | bedrock-mantle | Claude Opus 5.5 | 2026-09-22 | - |
| `anthropic.claude-sonnet-4-20250514-v1:0` | Claude Sonnet | `anthropic.claude-sonnet-5-5` | bedrock-runtime | Claude Sonnet 5.5 | 2026-09-28 | us, eu, au, global |
| `anthropic.claude-sonnet-4-20250514-v1:0` | Claude Sonnet | `anthropic.claude-sonnet-5-5` | bedrock-mantle | Claude Sonnet 5.5 | 2026-09-28 | - |
| `anthropic.claude-sonnet-4-5-20250929-v1:0` | Claude Sonnet | `anthropic.claude-sonnet-5-5` | bedrock-runtime | Claude Sonnet 5.5 | 2026-09-28 | us, eu, au, global |
| `anthropic.claude-sonnet-4-5-20250929-v1:0` | Claude Sonnet | `anthropic.claude-sonnet-5-5` | bedrock-mantle | Claude Sonnet 5.5 | 2026-09-28 | - |
| `anthropic.claude-v2` | Claude Sonnet | `anthropic.claude-sonnet-5-5` | bedrock-runtime | Claude Sonnet 5.5 | 2026-09-28 | us, eu, au, global |
| `anthropic.claude-v2` | Claude Sonnet | `anthropic.claude-sonnet-5-5` | bedrock-mantle | Claude Sonnet 5.5 | 2026-09-28 | - |
| `anthropic.claude-v2:1` | Claude Sonnet | `anthropic.claude-sonnet-5-5` | bedrock-runtime | Claude Sonnet 5.5 | 2026-09-28 | us, eu, au, global |
| `anthropic.claude-v2:1` | Claude Sonnet | `anthropic.claude-sonnet-5-5` | bedrock-mantle | Claude Sonnet 5.5 | 2026-09-28 | - |
| `cohere.command-r-plus-v1:0` | Command R+ | - | - | - | - | - |
| `cohere.command-r-v1:0` | Command R | - | - | - | - | - |
| `deepseek.r1-v1:0` | DeepSeek | `deepseek.v3.2` | bedrock-runtime | DeepSeek V3.2 | 2025-12-01 | - |
| `deepseek.r1-v1:0` | DeepSeek | `deepseek.v3.2` | bedrock-mantle | DeepSeek V3.2 | 2025-12-01 | - |
| `deepseek.v3-v1:0` | DeepSeek | `deepseek.v3.2` | bedrock-runtime | DeepSeek V3.2 | 2025-12-01 | - |
| `deepseek.v3-v1:0` | DeepSeek | `deepseek.v3.2` | bedrock-mantle | DeepSeek V3.2 | 2025-12-01 | - |
| `deepseek.v3.1` | DeepSeek | `deepseek.v3.2` | bedrock-mantle | DeepSeek V3.2 | 2025-12-01 | - |
| `deepseek.v3.1` | DeepSeek | `deepseek.v3.2` | bedrock-runtime | DeepSeek V3.2 | 2025-12-01 | - |
| `google.gemma-3-12b-it` | Gemma | `google.gemma-4-26b-a4b` | bedrock-mantle | Gemma 4 26B-A4B | 2026-03-31 | - |
| `google.gemma-3-12b-it` | Gemma | `google.gemma-4-31b` | bedrock-mantle | Gemma 4 31B | 2026-03-31 | - |
| `google.gemma-3-12b-it` | Gemma | `google.gemma-4-e2b` | bedrock-mantle | Gemma 4 E2B | 2026-03-31 | - |
| `google.gemma-3-27b-it` | Gemma | `google.gemma-4-26b-a4b` | bedrock-mantle | Gemma 4 26B-A4B | 2026-03-31 | - |
| `google.gemma-3-27b-it` | Gemma | `google.gemma-4-31b` | bedrock-mantle | Gemma 4 31B | 2026-03-31 | - |
| `google.gemma-3-27b-it` | Gemma | `google.gemma-4-e2b` | bedrock-mantle | Gemma 4 E2B | 2026-03-31 | - |
| `google.gemma-3-4b-it` | Gemma | `google.gemma-4-26b-a4b` | bedrock-mantle | Gemma 4 26B-A4B | 2026-03-31 | - |
| `google.gemma-3-4b-it` | Gemma | `google.gemma-4-31b` | bedrock-mantle | Gemma 4 31B | 2026-03-31 | - |
| `google.gemma-3-4b-it` | Gemma | `google.gemma-4-e2b` | bedrock-mantle | Gemma 4 E2B | 2026-03-31 | - |
| `meta.llama3-1-405b-instruct-v1:0` | Llama | - | - | - | - | - |
| `meta.llama3-1-70b-instruct-v1:0` | Llama | - | - | - | - | - |
| `meta.llama3-1-8b-instruct-v1:0` | Llama | - | - | - | - | - |
| `meta.llama3-2-11b-instruct-v1:0` | Llama | - | - | - | - | - |
| `meta.llama3-2-1b-instruct-v1:0` | Llama | - | - | - | - | - |
| `meta.llama3-2-3b-instruct-v1:0` | Llama | - | - | - | - | - |
| `meta.llama3-2-90b-instruct-v1:0` | Llama | - | - | - | - | - |
| `meta.llama3-3-70b-instruct-v1:0` | Llama | - | - | - | - | - |
| `meta.llama3-70b-instruct-v1:0` | Llama | - | - | - | - | - |
| `meta.llama3-8b-instruct-v1:0` | Llama | - | - | - | - | - |
| `meta.llama4-maverick-17b-instruct-v1:0` | Llama Maverick | - | - | - | - | - |
| `meta.llama4-scout-17b-instruct-v1:0` | Llama Scout | - | - | - | - | - |
| `minimax.minimax-m2` | MiniMax | `minimax.minimax-m2.5` | bedrock-runtime | MiniMax M2.5 | 2026-02-12 | - |
| `minimax.minimax-m2` | MiniMax | `minimax.minimax-m2.5` | bedrock-mantle | MiniMax M2.5 | 2026-02-12 | - |
| `minimax.minimax-m2.1` | MiniMax | `minimax.minimax-m2.5` | bedrock-runtime | MiniMax M2.5 | 2026-02-12 | - |
| `minimax.minimax-m2.1` | MiniMax | `minimax.minimax-m2.5` | bedrock-mantle | MiniMax M2.5 | 2026-02-12 | - |
| `mistral.devstral-2-123b` | Devstral | - | - | - | - | - |
| `mistral.mistral-7b-instruct-v0:2` | Mistral | - | - | - | - | - |
| `mistral.mixtral-8x7b-instruct-v0:1` | Mixtral | - | - | - | - | - |
| `mistral.voxtral-mini-3b-2507` | Voxtral Mini | - | - | - | - | - |
| `mistral.voxtral-small-24b-2507` | Voxtral Small | - | - | - | - | - |
| `moonshot.kimi-k2-thinking` | Kimi | `moonshotai.kimi-k3` | bedrock-runtime | Kimi K3 | 2026-09-18 | us, global |
| `moonshotai.kimi-k2-thinking` | Kimi | `moonshotai.kimi-k3` | bedrock-runtime | Kimi K3 | 2026-09-18 | us, global |
| `nvidia.nemotron-nano-12b-v2` | NVIDIA Nemotron Nano VL | - | - | - | - | - |
| `nvidia.nemotron-nano-9b-v2` | Nemotron Nano | `nvidia.nemotron-nano-3-30b` | bedrock-runtime | Nemotron Nano 3 30B | 2025-12-15 | us-gov |
| `nvidia.nemotron-nano-9b-v2` | Nemotron Nano | `nvidia.nemotron-nano-3-30b` | bedrock-mantle | Nemotron Nano 3 30B | 2025-12-15 | - |
| `qwen.qwen3-coder-30b-a3b-instruct` | Qwen Coder Next | `qwen.qwen3-coder-next` | bedrock-mantle | Qwen3 Coder Next | 2026-02-04 | - |
| `qwen.qwen3-coder-30b-a3b-instruct` | Qwen Coder Next | `qwen.qwen3-coder-next` | bedrock-runtime | Qwen3 Coder Next | 2026-02-04 | - |
| `qwen.qwen3-coder-30b-a3b-v1:0` | Qwen Coder Next | `qwen.qwen3-coder-next` | bedrock-runtime | Qwen3 Coder Next | 2026-02-04 | - |
| `qwen.qwen3-coder-30b-a3b-v1:0` | Qwen Coder Next | `qwen.qwen3-coder-next` | bedrock-mantle | Qwen3 Coder Next | 2026-02-04 | - |
| `qwen.qwen3-coder-480b-a35b-instruct` | Qwen Coder Next | `qwen.qwen3-coder-next` | bedrock-mantle | Qwen3 Coder Next | 2026-02-04 | - |
| `qwen.qwen3-coder-480b-a35b-instruct` | Qwen Coder Next | `qwen.qwen3-coder-next` | bedrock-runtime | Qwen3 Coder Next | 2026-02-04 | - |
| `qwen.qwen3-coder-480b-a35b-v1:0` | Qwen Coder Next | `qwen.qwen3-coder-next` | bedrock-runtime | Qwen3 Coder Next | 2026-02-04 | - |
| `qwen.qwen3-coder-480b-a35b-v1:0` | Qwen Coder Next | `qwen.qwen3-coder-next` | bedrock-mantle | Qwen3 Coder Next | 2026-02-04 | - |
| `twelvelabs.marengo-embed-2-7-v1:0` | Marengo Embed | - | - | - | - | - |
| `twelvelabs.marengo-embed-3-0-v1:0` | Marengo Embed | - | - | - | - | - |
| `twelvelabs.pegasus-1-2-v1:0` | Pegasus | `twelvelabs.pegasus-1-5-v1:0` | bedrock-runtime | Pegasus v1.5 | 2026-10-08 | us, global |
| `writer.palmyra-x4-v1:0` | Palmyra | - | - | - | - | - |
| `writer.palmyra-x5-v1:0` | Palmyra | - | - | - | - | - |
| `zai.glm-4.7` | GLM | `zai.glm-5.3` | bedrock-runtime | GLM 5.3 | 2026-10-05 | us, global |
| `zai.glm-4.7-flash` | GLM Flash | - | - | - | - | - |

### Active models

| Model ID | Endpoint | Provider | Model name | Model family | Launch date | Inference profile prefixes | Modalities | Model card |
|---|---|---|---|---|---|---|---|---|
| `amazon.nova-2-multimodal-embeddings-v1:0` | bedrock-runtime | Amazon | Amazon Nova Multimodal Embeddings | Amazon Nova Multimodal Embeddings | 2025-10-28 | - | in: Audio, Image, Text, Video; out: Embedding | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-amazon-nova-multimodal-embeddings.html |
| `amazon.nova-2-lite-v1:0` | bedrock-runtime | Amazon | Nova 2 Lite | Nova Lite | 2025-12-02 | us, eu, jp, global | in: Image, Text, Video; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html |
| `amazon.nova-lite-v1:0` | bedrock-runtime | Amazon | Nova Lite | Nova Lite | 2024-12-05 | us, ca, eu, apac | in: Image, Text, Video; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-lite.html |
| `amazon.nova-micro-v1:0` | bedrock-runtime | Amazon | Nova Micro | Nova Micro | 2024-12-05 | us, eu | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-micro.html |
| `amazon.nova-pro-v1:0` | bedrock-runtime | Amazon | Nova Pro | Nova Pro | 2024-12-05 | us, eu, apac | in: Image, Text, Video; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-pro.html |
| `amazon.nova-2-5-sonic` | bedrock-runtime | Amazon | Nova 2.5 Sonic | Nova Sonic | 2026-10-05 | - | in: Speech, Text; out: Speech, Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-5-sonic.html |
| `amazon.nova-2-sonic-v1:0` | bedrock-runtime | Amazon | Nova 2 Sonic | Nova Sonic | 2025-12-02 | - | in: Speech, Text; out: Speech, Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-sonic.html |
| `amazon.titan-embed-image-v1` | bedrock-runtime | Amazon | Titan Multimodal Embeddings G1 | Titan Multimodal Embeddings | 2023-11-29 | - | in: Image, Text; out: Embedding | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-titan-multimodal-embeddings-g1.html |
| `amazon.titan-embed-text-v2:0` | bedrock-runtime | Amazon | Titan Text Embeddings V2 | Titan Text Embeddings | 2024-04-30 | - | in: Text; out: Embedding | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-titan-text-embeddings-v2.html |
| `amazon.titan-embed-text-v1` | bedrock-runtime | Amazon | Titan Embeddings G1 - Text | Titan Text Embeddings | 2023-09-28 | - | in: Text; out: Embedding | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-titan-embeddings-g1---text.html |
| `amazon.titan-embed-g1-text-02` | bedrock-runtime | Amazon | Titan Embeddings G1 - Text v2 | Titan Text Embeddings | - | - | in: Text; out: Embedding | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-titan-text-embeddings-v2-2.html |
| `anthropic.claude-fable-5-1` | bedrock-mantle | Anthropic | Claude Fable 5.1 | Claude Fable | 2026-09-01 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-fable-5-1.html |
| `anthropic.claude-fable-5-1` | bedrock-runtime | Anthropic | Claude Fable 5.1 | Claude Fable | 2026-09-01 | us, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-fable-5-1.html |
| `anthropic.claude-fable-5` | bedrock-mantle | Anthropic | Claude Fable 5 | Claude Fable | 2026-06-09 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-fable-5.html |
| `anthropic.claude-fable-5` | bedrock-runtime | Anthropic | Claude Fable 5 | Claude Fable | 2026-06-09 | us, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-fable-5.html |
| `anthropic.claude-haiku-5-5` | bedrock-mantle | Anthropic | Claude Haiku 5.5 | Claude Haiku | 2026-10-07 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.html |
| `anthropic.claude-haiku-5-5` | bedrock-runtime | Anthropic | Claude Haiku 5.5 | Claude Haiku | 2026-10-07 | us, ca, eu, au, jp, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.html |
| `anthropic.claude-haiku-4-5` | bedrock-mantle | Anthropic | Claude Haiku 4.5 | Claude Haiku | 2025-10-16 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html |
| `anthropic.claude-mythos-5-1` | bedrock-runtime | Anthropic | Claude Mythos 5.1 | Claude Mythos | 2026-09-01 | us, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-mythos-5-1.html |
| `anthropic.claude-mythos-5` | bedrock-mantle | Anthropic | Claude Mythos 5 | Claude Mythos | 2026-06-09 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-mythos-5.html |
| `anthropic.claude-opus-5-5` | bedrock-mantle | Anthropic | Claude Opus 5.5 | Claude Opus | 2026-09-22 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5-5.html |
| `anthropic.claude-opus-5-5` | bedrock-runtime | Anthropic | Claude Opus 5.5 | Claude Opus | 2026-09-22 | us, eu, au, jp, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5-5.html |
| `anthropic.claude-opus-5` | bedrock-mantle | Anthropic | Claude Opus 5 | Claude Opus | 2026-07-24 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5.html |
| `anthropic.claude-opus-5` | bedrock-runtime | Anthropic | Claude Opus 5 | Claude Opus | 2026-07-24 | us, eu, au, in, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5.html |
| `anthropic.claude-opus-4-8` | bedrock-mantle | Anthropic | Claude Opus 4.8 | Claude Opus | 2026-05-28 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-4-8.html |
| `anthropic.claude-opus-4-8` | bedrock-runtime | Anthropic | Claude Opus 4.8 | Claude Opus | 2026-05-28 | us, eu, jp, au, us-gov, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-4-8.html |
| `anthropic.claude-opus-4-7` | bedrock-mantle | Anthropic | Claude Opus 4.7 | Claude Opus | 2026-04-16 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-4-7.html |
| `anthropic.claude-opus-4-7` | bedrock-runtime | Anthropic | Claude Opus 4.7 | Claude Opus | 2026-04-16 | us, eu, jp, au, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-4-7.html |
| `anthropic.claude-opus-4-6-v1` | bedrock-runtime | Anthropic | Claude Opus 4.6 | Claude Opus | 2026-02-05 | us, eu, au, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-4-6.html |
| `anthropic.claude-opus-4-5-20251101-v1:0` | bedrock-runtime | Anthropic | Claude Opus 4.5 | Claude Opus | 2025-11-24 | us, eu, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-4-5.html |
| `anthropic.claude-sonnet-5-5` | bedrock-mantle | Anthropic | Claude Sonnet 5.5 | Claude Sonnet | 2026-09-28 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5-5.html |
| `anthropic.claude-sonnet-5-5` | bedrock-runtime | Anthropic | Claude Sonnet 5.5 | Claude Sonnet | 2026-09-28 | us, eu, au, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5-5.html |
| `anthropic.claude-sonnet-5` | bedrock-mantle | Anthropic | Claude Sonnet 5 | Claude Sonnet | 2026-06-30 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5.html |
| `anthropic.claude-sonnet-5` | bedrock-runtime | Anthropic | Claude Sonnet 5 | Claude Sonnet | 2026-06-30 | us, eu, au, in, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5.html |
| `anthropic.claude-sonnet-4-6` | bedrock-runtime | Anthropic | Claude Sonnet 4.6 | Claude Sonnet | 2026-02-17 | us, eu, au, jp, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-6.html |
| `cohere.embed-v4:0` | bedrock-runtime | Cohere | Embed v4 | Embed | 2025-04-15 | us, eu, global | in: Image, Text; out: Embedding | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-cohere-embed-v4.html |
| `cohere.embed-english-v3` | bedrock-runtime | Cohere | Embed English | Embed English | 2023-11-02 | - | in: Text; out: Embedding | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-cohere-embed-english.html |
| `cohere.embed-multilingual-v3` | bedrock-runtime | Cohere | Embed Multilingual | Embed Multilingual | 2023-11-02 | - | in: Text; out: Embedding | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-cohere-embed-multilingual.html |
| `cohere.rerank-v3-5:0` | bedrock-runtime | Cohere | Rerank 3.5 | Rerank | 2024-12-02 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-cohere-rerank-3-5.html |
| `deepseek.v3.2` | bedrock-mantle | DeepSeek | DeepSeek V3.2 | DeepSeek | 2025-12-01 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-deepseek-deepseek-v3-2.html |
| `deepseek.v3.2` | bedrock-runtime | DeepSeek | DeepSeek V3.2 | DeepSeek | 2025-12-01 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-deepseek-deepseek-v3-2.html |
| `google.gemma-4-26b-a4b` | bedrock-mantle | Google | Gemma 4 26B-A4B | Gemma | 2026-03-31 | - | in: Image, Text, Video; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-google-gemma-4-26b-a4b.html |
| `google.gemma-4-31b` | bedrock-mantle | Google | Gemma 4 31B | Gemma | 2026-03-31 | - | in: Image, Text, Video; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-google-gemma-4-31b.html |
| `google.gemma-4-e2b` | bedrock-mantle | Google | Gemma 4 E2B | Gemma | 2026-03-31 | - | in: Audio, Image, Text, Video; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-google-gemma-4-e2b.html |
| `luma.ray-v2:0` | bedrock-runtime | Luma AI | Ray2 | Ray | 2025-01-23 | - | in: Image, Text; out: Video | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-luma-ai-ray2.html |
| `minimax.minimax-m2.5` | bedrock-mantle | MiniMax | MiniMax M2.5 | MiniMax | 2026-02-12 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-minimax-minimax-m2-5.html |
| `minimax.minimax-m2.5` | bedrock-runtime | MiniMax | MiniMax M2.5 | MiniMax | 2026-02-12 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-minimax-minimax-m2-5.html |
| `mistral.magistral-small-2509` | bedrock-mantle | Mistral AI | Magistral Small 2509 | Magistral Small | 2025-09 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-mistral-ai-magistral-small-2509.html |
| `mistral.magistral-small-2509` | bedrock-runtime | Mistral AI | Magistral Small 2509 | Magistral Small | 2025-09 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-mistral-ai-magistral-small-2509.html |
| `mistral.ministral-3-14b-instruct` | bedrock-mantle | Mistral AI | Ministral 14B 3.0 | Ministral | 2025-12-02 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-mistral-ai-ministral-14b-3-0.html |
| `mistral.ministral-3-14b-instruct` | bedrock-runtime | Mistral AI | Ministral 14B 3.0 | Ministral | 2025-12-02 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-mistral-ai-ministral-14b-3-0.html |
| `mistral.ministral-3-3b-instruct` | bedrock-mantle | Mistral AI | Ministral 3B | Ministral | 2025-12-02 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-mistral-ai-ministral-3b.html |
| `mistral.ministral-3-3b-instruct` | bedrock-runtime | Mistral AI | Ministral 3B | Ministral | 2025-12-02 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-mistral-ai-ministral-3b.html |
| `mistral.ministral-3-8b-instruct` | bedrock-mantle | Mistral AI | Ministral 3 8B | Ministral | 2025-12-02 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-mistral-ai-ministral-3-8b.html |
| `mistral.ministral-3-8b-instruct` | bedrock-runtime | Mistral AI | Ministral 3 8B | Ministral | 2025-12-02 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-mistral-ai-ministral-3-8b.html |
| `mistral.mistral-large-3-675b-instruct` | bedrock-mantle | Mistral AI | Mistral Large 3 | Mistral Large | 2025-12-02 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-mistral-ai-mistral-large-3.html |
| `mistral.mistral-large-3-675b-instruct` | bedrock-runtime | Mistral AI | Mistral Large 3 | Mistral Large | 2025-12-02 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-mistral-ai-mistral-large-3.html |
| `mistral.mistral-large-2402-v1:0` | bedrock-runtime | Mistral AI | Mistral Large | Mistral Large | 2024-02-26 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-mistral-ai-mistral-large.html |
| `mistral.mistral-small-2402-v1:0` | bedrock-runtime | Mistral AI | Mistral Small | Mistral Small | 2025-12-16 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-mistral-ai-mistral-small.html |
| `mistral.pixtral-large-2502-v1:0` | bedrock-runtime | Mistral AI | Pixtral Large | Pixtral Large | 2024-11-19 | us, eu | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-mistral-ai-pixtral-large.html |
| `moonshotai.kimi-k3` | bedrock-runtime | Moonshot AI | Kimi K3 | Kimi | 2026-09-18 | us, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-moonshot-ai-kimi-k3.html |
| `moonshotai.kimi-k2.5` | bedrock-mantle | Moonshot AI | Kimi K2.5 | Kimi | 2026-01-27 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-moonshot-ai-kimi-k2-5.html |
| `moonshotai.kimi-k2.5` | bedrock-runtime | Moonshot AI | Kimi K2.5 | Kimi | 2026-01-27 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-moonshot-ai-kimi-k2-5.html |
| `nvidia.nemotron-nano-3-30b` | bedrock-mantle | NVIDIA | Nemotron Nano 3 30B | Nemotron Nano | 2025-12-15 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-nvidia-nemotron-nano-3-30b.html |
| `nvidia.nemotron-nano-3-30b` | bedrock-runtime | NVIDIA | Nemotron Nano 3 30B | Nemotron Nano | 2025-12-15 | us-gov | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-nvidia-nemotron-nano-3-30b.html |
| `nvidia.nemotron-super-3-120b` | bedrock-mantle | NVIDIA | NVIDIA Nemotron 3 Super 120B | NVIDIA Nemotron Super | 2026-03-11 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-nvidia-nemotron-super-3-120b.html |
| `nvidia.nemotron-super-3-120b` | bedrock-runtime | NVIDIA | NVIDIA Nemotron 3 Super 120B | NVIDIA Nemotron Super | 2026-03-11 | us-gov | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-nvidia-nemotron-super-3-120b.html |
| `openai.gpt-daybreak-blue-5.6-sol` | bedrock-mantle | OpenAI | Daybreak Blue: GPT-5.6 Sol | Daybreak Blue GPT Sol | 2026-08-12 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-daybreak-blue-56-sol.html |
| `openai.gpt-5.6-cyber` | bedrock-mantle | OpenAI | Daybreak Red: GPT-5.6 Cyber | Daybreak Red GPT Cyber | 2026-08-12 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-56-cyber.html |
| `openai.gpt-5.4` | bedrock-mantle | OpenAI | GPT-5.4 | GPT | 2026-06-01 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-54.html |
| `openai.gpt-5.4` | bedrock-runtime | OpenAI | GPT-5.4 | GPT | 2026-06-01 | us, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-54.html |
| `openai.gpt-5.5` | bedrock-mantle | OpenAI | GPT-5.5 | GPT | 2026-06-01 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-55.html |
| `openai.gpt-5.5` | bedrock-runtime | OpenAI | GPT-5.5 | GPT | 2026-06-01 | us, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-55.html |
| `openai.gpt-6-astra` | bedrock-mantle | OpenAI | GPT-6 Astra | GPT Astra | 2026-09-08 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-astra.html |
| `openai.gpt-6-astra` | bedrock-runtime | OpenAI | GPT-6 Astra | GPT Astra | 2026-09-08 | us, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-astra.html |
| `openai.gpt-6-luna` | bedrock-mantle | OpenAI | GPT-6 Luna | GPT Luna | 2026-09-22 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-luna.html |
| `openai.gpt-6-luna` | bedrock-runtime | OpenAI | GPT-6 Luna | GPT Luna | 2026-09-22 | us, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-luna.html |
| `openai.gpt-5.6-luna` | bedrock-mantle | OpenAI | GPT-5.6 Luna | GPT Luna | 2026-07-13 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-56-luna.html |
| `openai.gpt-5.6-luna` | bedrock-runtime | OpenAI | GPT-5.6 Luna | GPT Luna | 2026-07-13 | us, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-56-luna.html |
| `openai.gpt-oss-120b` | bedrock-mantle | OpenAI | gpt-oss-120b | gpt oss | 2025-08-05 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-oss-120b.html |
| `openai.gpt-oss-120b-1:0` | bedrock-runtime | OpenAI | gpt-oss-120b | gpt oss | 2025-08-05 | us-gov | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-oss-120b.html |
| `openai.gpt-oss-20b` | bedrock-mantle | OpenAI | gpt-oss-20b | gpt oss | 2025-08-05 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-oss-20b.html |
| `openai.gpt-oss-20b-1:0` | bedrock-runtime | OpenAI | gpt-oss-20b | gpt oss | 2025-08-05 | us-gov | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-oss-20b.html |
| `openai.gpt-oss-safeguard-120b` | bedrock-mantle | OpenAI | GPT OSS Safeguard 120B | GPT OSS Safeguard | 2025-10-29 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-oss-safeguard-120b.html |
| `openai.gpt-oss-safeguard-120b` | bedrock-runtime | OpenAI | GPT OSS Safeguard 120B | GPT OSS Safeguard | 2025-10-29 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-oss-safeguard-120b.html |
| `openai.gpt-oss-safeguard-20b` | bedrock-mantle | OpenAI | GPT OSS Safeguard 20B | GPT OSS Safeguard | 2025-10-29 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-oss-safeguard-20b.html |
| `openai.gpt-oss-safeguard-20b` | bedrock-runtime | OpenAI | GPT OSS Safeguard 20B | GPT OSS Safeguard | 2025-10-29 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-oss-safeguard-20b.html |
| `openai.gpt-6.1-sol` | bedrock-mantle | OpenAI | GPT-6.1 Sol | GPT Sol | 2026-09-29 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-1-sol.html |
| `openai.gpt-6.1-sol` | bedrock-runtime | OpenAI | GPT-6.1 Sol | GPT Sol | 2026-09-29 | us, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-1-sol.html |
| `openai.gpt-6-sol` | bedrock-mantle | OpenAI | GPT-6 Sol | GPT Sol | 2026-09-22 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-sol.html |
| `openai.gpt-6-sol` | bedrock-runtime | OpenAI | GPT-6 Sol | GPT Sol | 2026-09-22 | us, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-sol.html |
| `openai.gpt-5.6-sol` | bedrock-mantle | OpenAI | GPT-5.6 Sol | GPT Sol | 2026-07-13 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-56-sol.html |
| `openai.gpt-5.6-sol` | bedrock-runtime | OpenAI | GPT-5.6 Sol | GPT Sol | 2026-07-13 | us, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-56-sol.html |
| `openai.gpt-6.1-terra` | bedrock-mantle | OpenAI | GPT-6.1 Terra | GPT Terra | 2026-10-26 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-1-terra.html |
| `openai.gpt-6.1-terra` | bedrock-runtime | OpenAI | GPT-6.1 Terra | GPT Terra | 2026-10-26 | us, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-1-terra.html |
| `openai.gpt-5.6-terra` | bedrock-mantle | OpenAI | GPT-5.6 Terra | GPT Terra | 2026-07-13 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-56-terra.html |
| `openai.gpt-5.6-terra` | bedrock-runtime | OpenAI | GPT-5.6 Terra | GPT Terra | 2026-07-13 | us, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-56-terra.html |
| `qwen.qwen3-32b` | bedrock-mantle | Qwen | Qwen3 32B | Qwen | 2025-04-29 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-32b.html |
| `qwen.qwen3-32b-v1:0` | bedrock-runtime | Qwen | Qwen3 32B | Qwen | 2025-04-29 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-32b.html |
| `qwen.qwen3-235b-a22b-2507` | bedrock-mantle | Qwen | Qwen3 235B A22B 2507 | Qwen | 2025-04-28 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-235b-a22b-2507.html |
| `qwen.qwen3-235b-a22b-2507-v1:0` | bedrock-runtime | Qwen | Qwen3 235B A22B 2507 | Qwen | 2025-04-28 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-235b-a22b-2507.html |
| `qwen.qwen3-coder-next` | bedrock-mantle | Qwen | Qwen3 Coder Next | Qwen Coder Next | 2026-02-04 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-coder-next.html |
| `qwen.qwen3-coder-next` | bedrock-runtime | Qwen | Qwen3 Coder Next | Qwen Coder Next | 2026-02-04 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-coder-next.html |
| `qwen.qwen3-next-80b-a3b` | bedrock-runtime | Qwen | Qwen3 Next 80B A3B | Qwen Next | 2025-09-11 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-next-80b-a3b.html |
| `qwen.qwen3-next-80b-a3b-instruct` | bedrock-mantle | Qwen | Qwen3 Next 80B A3B | Qwen Next | 2025-09-11 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-next-80b-a3b.html |
| `qwen.qwen3-vl-235b-a22b` | bedrock-runtime | Qwen | Qwen3 VL 235B A22B | Qwen VL | 2025-09-23 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-vl-235b-a22b.html |
| `qwen.qwen3-vl-235b-a22b-instruct` | bedrock-mantle | Qwen | Qwen3 VL 235B A22B | Qwen VL | 2025-09-23 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-vl-235b-a22b.html |
| `stability.sd3-5-large-v1:0` | bedrock-runtime | Stability AI | Stable Diffusion 3.5 Large | Stable Diffusion Large | - | - | in: Image, Text; out: Image | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-stability-ai-stable-diffusion-3-5-large.html |
| `stability.stable-conservative-upscale-v1:0` | bedrock-runtime | Stability AI | Stable Image Conservative Upscale | Stable Image Conservative Upscale | 2024-05-20 | us | in: Image, Text; out: Image | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-stability-ai-stable-image-conservative-upscale.html |
| `stability.stable-image-control-sketch-v1:0` | bedrock-runtime | Stability AI | Stable Image Control Sketch | Stable Image Control Sketch | 2023-07-13 | us | in: Image, Text; out: Image | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-stability-ai-stable-image-control-sketch.html |
| `stability.stable-image-control-structure-v1:0` | bedrock-runtime | Stability AI | Stable Image Control Structure | Stable Image Control Structure | 2024-04-30 | us | in: Image, Text; out: Image | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-stability-ai-stable-image-control-structure.html |
| `stability.stable-image-core-v1:1` | bedrock-runtime | Stability AI | Stable Image Core 1.0 | Stable Image Core | - | - | in: Text; out: Image | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-stability-ai-stable-image-core-1-0.html |
| `stability.stable-creative-upscale-v1:0` | bedrock-runtime | Stability AI | Stable Image Creative Upscale | Stable Image Creative Upscale | 2024-03-21 | us | in: Image, Text; out: Image | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-stability-ai-stable-image-creative-upscale.html |
| `stability.stable-image-erase-object-v1:0` | bedrock-runtime | Stability AI | Stable Image Erase Object | Stable Image Erase Object | 2024-05-20 | us | in: Image, Text; out: Image | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-stability-ai-stable-image-erase-object.html |
| `stability.stable-fast-upscale-v1:0` | bedrock-runtime | Stability AI | Stable Image Fast Upscale | Stable Image Fast Upscale | 2024-09-10 | us | in: Image, Text; out: Image | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-stability-ai-stable-image-fast-upscale.html |
| `stability.stable-image-inpaint-v1:0` | bedrock-runtime | Stability AI | Stable Image Inpaint | Stable Image Inpaint | 2022-11 | us | in: Image, Text; out: Image | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-stability-ai-stable-image-inpaint.html |
| `stability.stable-outpaint-v1:0` | bedrock-runtime | Stability AI | Stable Image Outpaint | Stable Image Outpaint | 2022-11-24 | us | in: Image, Text; out: Image | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-stability-ai-stable-image-outpaint.html |
| `stability.stable-image-remove-background-v1:0` | bedrock-runtime | Stability AI | Stable Image Remove Background | Stable Image Remove Background | 2024-11-07 | us | in: Image, Text; out: Image | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-stability-ai-stable-image-remove-background.html |
| `stability.stable-image-search-recolor-v1:0` | bedrock-runtime | Stability AI | Stable Image Search and Recolor | Stable Image Search and Recolor | 2024-08-19 | us | in: Image, Text; out: Image | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-stability-ai-stable-image-search-and-recolor.html |
| `stability.stable-image-search-replace-v1:0` | bedrock-runtime | Stability AI | Stable Image Search and Replace | Stable Image Search and Replace | 2024-10 | us | in: Image, Text; out: Image | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-stability-ai-stable-image-search-and-replace.html |
| `stability.stable-image-style-guide-v1:0` | bedrock-runtime | Stability AI | Stable Image Style Guide | Stable Image Style Guide | 2024-10 | us | in: Image, Text; out: Image | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-stability-ai-stable-image-style-guide.html |
| `stability.stable-style-transfer-v1:0` | bedrock-runtime | Stability AI | Stable Image Style Transfer | Stable Image Style Transfer | 2024-10 | us | in: Image, Text; out: Image | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-stability-ai-stable-image-style-transfer.html |
| `stability.stable-image-ultra-v1:1` | bedrock-runtime | Stability AI | Stable Image Ultra 1.0 | Stable Image Ultra | - | - | in: Text; out: Image | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-stability-ai-stable-image-ultra-1-0.html |
| `twelvelabs.pegasus-1-5-v1:0` | bedrock-runtime | TwelveLabs | Pegasus v1.5 | Pegasus | 2026-10-08 | us, global | in: Text, Video; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-twelvelabs-pegasus-v1-5.html |
| `writer.palmyra-vision-7b` | bedrock-mantle | Writer | Palmyra Vision 7B | Palmyra Vision | 2026-03-26 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-writer-palmyra-vision-7b.html |
| `writer.palmyra-vision-7b` | bedrock-runtime | Writer | Palmyra Vision 7B | Palmyra Vision | 2026-03-26 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-writer-palmyra-vision-7b.html |
| `xai.grok-4.7` | bedrock-runtime | xAI | Grok 4.7 | Grok | 2026-09-28 | us, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-7.html |
| `xai.grok-4.6` | bedrock-mantle | xAI | Grok 4.6 | Grok | 2026-08-18 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-6.html |
| `xai.grok-4.6` | bedrock-runtime | xAI | Grok 4.6 | Grok | 2026-08-18 | us, global | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-6.html |
| `xai.grok-4.3` | bedrock-mantle | xAI | Grok 4.3 | Grok | 2026-06-15 | - | in: Image, Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-3.html |
| `zai.glm-5.3` | bedrock-runtime | Z.AI | GLM 5.3 | GLM | 2026-10-05 | us, global | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-zai-glm-5-3.html |
| `zai.glm-5` | bedrock-mantle | Z.AI | GLM 5 | GLM | 2026-02-11 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-zai-glm-5.html |
| `zai.glm-5` | bedrock-runtime | Z.AI | GLM 5 | GLM | 2026-02-11 | - | in: Text; out: Text | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-zai-glm-5.html |
