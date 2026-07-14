variable "project_name" {
  type = string
}

variable "cluster_version" {
  description = "Kubernetes version for the EKS control plane"
  type        = string
  default     = "1.31"
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  description = "Worker nodes run in private subnets"
  type        = list(string)
}

variable "public_subnet_ids" {
  description = "Control plane ENIs also need public subnet access for the API endpoint"
  type        = list(string)
}

variable "node_instance_type" {
  type    = string
  default = "t3.small"
}

variable "node_desired_size" {
  type    = number
  default = 2
}

variable "node_min_size" {
  type    = number
  default = 1
}

variable "node_max_size" {
  type    = number
  default = 3
}
