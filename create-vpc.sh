#!/usr/bin/env bash
set -euo pipefail

# Creates a Fargate-ready VPC for ATX testing:
#   - VPC with DNS support
#   - Internet Gateway
#   - 1 public subnet (hosts NAT gateway)
#   - 2 private subnets (for Fargate tasks)
#   - NAT gateway for outbound internet from private subnets
#   - Security group (egress-only)
#
# Usage: AWS_PROFILE=atx-test ./create-vpc.sh

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
export AWS_DEFAULT_REGION="$REGION"

echo "Creating ATX test VPC in $REGION..."

# 1. Create VPC
VPC_ID=$(aws ec2 create-vpc --cidr-block 10.1.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=atx-test-vpc}]' \
  --query 'Vpc.VpcId' --output text)
aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-support
aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames
echo "✓ VPC: $VPC_ID"

# 2. Create Internet Gateway
IGW_ID=$(aws ec2 create-internet-gateway \
  --tag-specifications 'ResourceType=internet-gateway,Tags=[{Key=Name,Value=atx-test-igw}]' \
  --query 'InternetGateway.InternetGatewayId' --output text)
aws ec2 attach-internet-gateway --vpc-id "$VPC_ID" --internet-gateway-id "$IGW_ID"
echo "✓ Internet Gateway: $IGW_ID"

# 3. Create public subnet (for NAT gateway)
PUBLIC_SUBNET=$(aws ec2 create-subnet --vpc-id "$VPC_ID" \
  --cidr-block 10.1.0.0/24 --availability-zone "${REGION}a" \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=atx-test-public-1a}]' \
  --query 'Subnet.SubnetId' --output text)
echo "✓ Public subnet: $PUBLIC_SUBNET"

# 4. Create public route table and associate
PUBLIC_RT=$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
  --tag-specifications 'ResourceType=route-table,Tags=[{Key=Name,Value=atx-test-public-rt}]' \
  --query 'RouteTable.RouteTableId' --output text)
aws ec2 create-route --route-table-id "$PUBLIC_RT" --destination-cidr-block 0.0.0.0/0 --gateway-id "$IGW_ID" >/dev/null
aws ec2 associate-route-table --route-table-id "$PUBLIC_RT" --subnet-id "$PUBLIC_SUBNET" >/dev/null
echo "✓ Public route table: $PUBLIC_RT"

# 5. Create NAT Gateway
EIP_ALLOC=$(aws ec2 allocate-address --domain vpc \
  --tag-specifications 'ResourceType=elastic-ip,Tags=[{Key=Name,Value=atx-test-eip}]' \
  --query 'AllocationId' --output text)
NAT_ID=$(aws ec2 create-nat-gateway --subnet-id "$PUBLIC_SUBNET" --allocation-id "$EIP_ALLOC" \
  --tag-specifications 'ResourceType=natgateway,Tags=[{Key=Name,Value=atx-test-nat}]' \
  --query 'NatGateway.NatGatewayId' --output text)
echo "  Waiting for NAT gateway $NAT_ID to become available (~1-2 min)..."
aws ec2 wait nat-gateway-available --nat-gateway-ids "$NAT_ID"
echo "✓ NAT Gateway: $NAT_ID"

# 6. Create private subnets (for Fargate tasks)
PRIVATE_SUBNET_1=$(aws ec2 create-subnet --vpc-id "$VPC_ID" \
  --cidr-block 10.1.1.0/24 --availability-zone "${REGION}a" \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=atx-test-private-1a}]' \
  --query 'Subnet.SubnetId' --output text)
PRIVATE_SUBNET_2=$(aws ec2 create-subnet --vpc-id "$VPC_ID" \
  --cidr-block 10.1.2.0/24 --availability-zone "${REGION}b" \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=atx-test-private-1b}]' \
  --query 'Subnet.SubnetId' --output text)
echo "✓ Private subnets: $PRIVATE_SUBNET_1, $PRIVATE_SUBNET_2"

# 7. Create private route table (routes through NAT)
PRIVATE_RT=$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
  --tag-specifications 'ResourceType=route-table,Tags=[{Key=Name,Value=atx-test-private-rt}]' \
  --query 'RouteTable.RouteTableId' --output text)
aws ec2 create-route --route-table-id "$PRIVATE_RT" --destination-cidr-block 0.0.0.0/0 --nat-gateway-id "$NAT_ID" >/dev/null
aws ec2 associate-route-table --route-table-id "$PRIVATE_RT" --subnet-id "$PRIVATE_SUBNET_1" >/dev/null
aws ec2 associate-route-table --route-table-id "$PRIVATE_RT" --subnet-id "$PRIVATE_SUBNET_2" >/dev/null
echo "✓ Private route table: $PRIVATE_RT"

# 8. Create security group (egress-only for Fargate)
SG_ID=$(aws ec2 create-security-group --vpc-id "$VPC_ID" \
  --group-name atx-test-fargate-sg \
  --description "ATX Fargate tasks - egress only" \
  --query 'GroupId' --output text)
aws ec2 create-tags --resources "$SG_ID" --tags Key=Name,Value=atx-test-fargate-sg
echo "✓ Security Group: $SG_ID"

# 9. Print results
echo ""
echo "═══════════════════════════════════════════════"
echo " Add to cdk.json context:"
echo "═══════════════════════════════════════════════"
echo ""
echo "  \"existingVpcId\": \"$VPC_ID\","
echo "  \"existingSubnetIds\": [\"$PRIVATE_SUBNET_1\", \"$PRIVATE_SUBNET_2\"],"
echo "  \"existingSecurityGroupId\": \"$SG_ID\""
echo ""
