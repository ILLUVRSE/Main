resource "aws_db_subnet_group" "finance" {
  name       = "finance-ledger"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "finance" {
  identifier              = "finance-ledger"
  engine                  = "postgres"
  engine_version          = "15"
  instance_class          = "db.m6g.large"
  allocated_storage       = 200
  storage_encrypted       = true
  kms_key_id              = aws_kms_key.db.arn
  username                = var.db_username
  password                = var.db_password
  db_subnet_group_name    = aws_db_subnet_group.finance.name
  skip_final_snapshot     = false
  backup_retention_period = 35
  multi_az                = true
}
