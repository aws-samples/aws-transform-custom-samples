#!/usr/bin/env npx ts-node
/**
 * Generate IAM policies for the ATX remote execution caller.
 *
 * Produces two policies:
 *   1. atx-deployment-policy.json  — One-time CDK deployment (cdk deploy/destroy)
 *   2. atx-runtime-policy.json     — Day-to-day operations (invoke Lambdas, S3 sync)
 *
 * Usage: npx ts-node generate-caller-policy.ts
 */
export {};
