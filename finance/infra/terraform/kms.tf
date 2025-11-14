resource "aws_kms_key" "db" {
  description             = "Finance ledger database encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_key" "signing" {
  description             = "Finance proof signing"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}
