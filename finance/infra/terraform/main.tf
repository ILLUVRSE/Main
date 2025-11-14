terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

resource "aws_vpc" "finance" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  tags = { Name = "finance-ledger" }
}

resource "aws_subnet" "private" {
  count             = length(var.private_subnets)
  vpc_id            = aws_vpc.finance.id
  cidr_block        = var.private_subnets[count.index]
  map_public_ip_on_launch = false
}
