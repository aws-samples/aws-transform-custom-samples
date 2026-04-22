#!/bin/bash
# Deploy ATX Transform UI to S3 + CloudFront
# Works with both Option A (standalone) and Option B (CDK-managed AtxUiStack)
set -e

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION="us-east-1"
BUCKET_NAME="atx-transform-ui-${ACCOUNT_ID}"

echo "=== ATX Transform UI Deployment ==="
echo "Account: ${ACCOUNT_ID}"
echo "Region: ${REGION}"
echo ""

cd "$(dirname "$0")"

# Step 1: Build the UI (if dist/ doesn't exist or --build flag passed)
if [ ! -d "dist" ] || [ "$1" = "--build" ]; then
  echo "1. Building UI..."
  npx vite build
  echo "   Done."
else
  echo "1. Using existing dist/ build (pass --build to rebuild)"
fi

# Step 2: Detect existing CDK-managed stack or create standalone
echo ""
echo "2. Checking for existing infrastructure..."

CDK_STACK="AtxUiStack"
STANDALONE_STACK="atx-ui-standalone"

if aws cloudformation describe-stacks --stack-name "${CDK_STACK}" --region "${REGION}" &>/dev/null; then
  echo "   ✅ Found CDK-managed stack: ${CDK_STACK}"
  STACK_NAME="${CDK_STACK}"
elif aws cloudformation describe-stacks --stack-name "${STANDALONE_STACK}" --region "${REGION}" &>/dev/null; then
  echo "   ✅ Found standalone stack: ${STANDALONE_STACK}"
  STACK_NAME="${STANDALONE_STACK}"
else
  echo "   No existing UI stack found. Creating standalone CloudFormation stack..."
  STACK_NAME="${STANDALONE_STACK}"

  cat > /tmp/atx-ui-cfn.yaml << 'TEMPLATE'
AWSTemplateFormatVersion: '2010-09-09'
Description: ATX Transform UI - S3 Static Site + CloudFront (Standalone)

Resources:
  WebsiteBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Sub 'atx-transform-ui-${AWS::AccountId}'
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault:
              SSEAlgorithm: AES256

  CloudFrontOAI:
    Type: AWS::CloudFront::CloudFrontOriginAccessIdentity
    Properties:
      CloudFrontOriginAccessIdentityConfig:
        Comment: ATX Transform UI OAI

  BucketPolicy:
    Type: AWS::S3::BucketPolicy
    Properties:
      Bucket: !Ref WebsiteBucket
      PolicyDocument:
        Statement:
          - Effect: Allow
            Principal:
              CanonicalUser: !GetAtt CloudFrontOAI.S3CanonicalUserId
            Action: s3:GetObject
            Resource: !Sub '${WebsiteBucket.Arn}/*'

  Distribution:
    Type: AWS::CloudFront::Distribution
    Properties:
      DistributionConfig:
        Comment: ATX Transform UI
        Enabled: true
        DefaultRootObject: index.html
        Origins:
          - Id: S3Origin
            DomainName: !GetAtt WebsiteBucket.RegionalDomainName
            S3OriginConfig:
              OriginAccessIdentity: !Sub 'origin-access-identity/cloudfront/${CloudFrontOAI}'
        DefaultCacheBehavior:
          TargetOriginId: S3Origin
          ViewerProtocolPolicy: redirect-to-https
          AllowedMethods: [GET, HEAD]
          CachedMethods: [GET, HEAD]
          ForwardedValues:
            QueryString: false
          Compress: true
        CustomErrorResponses:
          - ErrorCode: 403
            ResponseCode: 200
            ResponsePagePath: /index.html
            ErrorCachingMinTTL: 300
          - ErrorCode: 404
            ResponseCode: 200
            ResponsePagePath: /index.html
            ErrorCachingMinTTL: 300
        ViewerCertificate:
          CloudFrontDefaultCertificate: true
          MinimumProtocolVersion: TLSv1.2_2021

Outputs:
  WebsiteUrl:
    Value: !Sub 'https://${Distribution.DomainName}'
    Description: Website URL
  DistributionId:
    Value: !Ref Distribution
    Description: CloudFront Distribution ID
  BucketName:
    Value: !Ref WebsiteBucket
    Description: S3 Bucket Name
TEMPLATE

  aws cloudformation deploy \
    --template-file /tmp/atx-ui-cfn.yaml \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}" \
    --no-fail-on-empty-changeset

  echo "   Stack created."
fi

# Step 3: Get outputs from whichever stack exists
echo ""
echo "3. Getting stack outputs..."

DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${REGION}" \
  --query 'Stacks[0].Outputs[?OutputKey==`DistributionId`].OutputValue' \
  --output text)

WEBSITE_URL=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${REGION}" \
  --query 'Stacks[0].Outputs[?contains(OutputKey,`WebsiteUrl`) || contains(OutputKey,`WebsiteURL`)].OutputValue' \
  --output text)

# Fallback: get domain from distribution
if [ -z "$WEBSITE_URL" ] || [ "$WEBSITE_URL" = "None" ]; then
  DOMAIN=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}" \
    --query 'Stacks[0].Outputs[?contains(OutputKey,`Domain`)].OutputValue' \
    --output text)
  if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "None" ]; then
    WEBSITE_URL="https://${DOMAIN}"
  fi
fi

echo "   Distribution ID: ${DISTRIBUTION_ID}"
echo "   Website URL: ${WEBSITE_URL}"

# Step 4: Upload files to S3
echo ""
echo "4. Uploading UI assets to S3..."
aws s3 sync dist/ "s3://${BUCKET_NAME}/" \
  --delete \
  --region "${REGION}" \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "index.html"

aws s3 cp dist/index.html "s3://${BUCKET_NAME}/index.html" \
  --region "${REGION}" \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/html"

echo "   Upload complete."

# Step 5: Invalidate CloudFront cache
echo ""
echo "5. Invalidating CloudFront cache..."
if [ -n "$DISTRIBUTION_ID" ] && [ "$DISTRIBUTION_ID" != "None" ]; then
  aws cloudfront create-invalidation \
    --distribution-id "${DISTRIBUTION_ID}" \
    --paths "/*" \
    --query 'Invalidation.Id' \
    --output text
else
  echo "   ⚠️  No distribution ID found, skipping invalidation"
fi

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Website URL: ${WEBSITE_URL}"
echo ""
echo "Note: CloudFront may take 1-2 minutes to propagate the invalidation."
