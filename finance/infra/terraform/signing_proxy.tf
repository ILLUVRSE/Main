resource "aws_instance" "signing_proxy" {
  ami           = var.signing_proxy_ami
  instance_type = "t3.small"
  subnet_id     = aws_subnet.private[0].id
  vpc_security_group_ids = [aws_security_group.signing_proxy.id]
  user_data = file("../ansible/signing-proxy.yml")
}

resource "aws_security_group" "signing_proxy" {
  name        = "finance-signing-proxy"
  description = "Strict ingress for signing proxy"
  vpc_id      = aws_vpc.finance.id

  ingress {
    protocol    = "tcp"
    from_port   = 8443
    to_port     = 8443
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
}
