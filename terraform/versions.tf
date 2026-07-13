terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  # Remote state in S3 - prevents state loss and enables team/CI use.
  # Create the bucket manually once before first `terraform init`:
  #   aws s3api create-bucket --bucket <your-unique-bucket-name> --region us-east-1
  #   aws s3api put-bucket-versioning --bucket <your-unique-bucket-name> \
  #     --versioning-configuration Status=Enabled
  backend "s3" {
    # Fill these in via `terraform init -backend-config=...` or a backend.hcl file
    # so the bucket name isn't hardcoded into version control.
    key     = "shopstack/terraform.tfstate"
    region  = "us-east-1"
    encrypt = true
  }
}

provider "aws" {
  region = var.aws_region
}
