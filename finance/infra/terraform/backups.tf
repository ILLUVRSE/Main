resource "aws_backup_vault" "finance" {
  name = "finance-ledger"
}

resource "aws_backup_plan" "finance" {
  name = "finance-ledger-plan"

  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.finance.name
    schedule          = "cron(0 2 * * ? *)"
    lifecycle {
      delete_after = 365
    }
  }
}

resource "aws_backup_selection" "finance" {
  name         = "finance-db"
  iam_role_arn = var.backup_role_arn
  plan_id      = aws_backup_plan.finance.id
  resources    = [aws_db_instance.finance.arn]
}
