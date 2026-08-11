# Formação AWS 5.0 — Fundamentos e computação

## Introdução + Criação da conta

- Free Tier
- Cobrança
- Serviço compartilhado x dedicado
- AZs e regiões

## Fundamentos na AWS + Tela Preta

- Criando VM e instalando as dependências
- Configurando terminal
- IPv4 público e privado
- Inbound e outbound
- Conexão remota: SSH e SSM
- Amazon Q, KIRO-CLI
- Linux
- Shell Script

## EC2

- Tipos de instância
- Linux e Windows
- Conexão remota em cada cenário
- Spot + Reserva + Créditos
- AMI, EBS, Elastic IP
- SSM
- SSH
- EC2 Instance Connect
- EC2 Instance Connect Endpoint

## Launch Template

- Tipo de instância
- Security group
- Storage
- Profile
- Integração com ASG
- AMI base
- Usando shell script (Linux) e PowerShell (Windows)
- userdata

## Auto Scaling Group

- Lançando instâncias
- Comunicação com outros serviços
- Escalando com base em métricas (CPU, fila, schedule)
- Estratégias para redução de custo e elasticidade
- Capacity Provider com ECS
- Estratégia de scaling com Spot Instance (em breve)

## Lambda

- Ideia do serverless
- Hello World
- invoke
- Cobrança
- Monitoramento
- Logs
- Schedule
- Empacotamento e deploy
- SAM
- Projeto prático de migração de uma app do zero para 100% serverless
  (tanto front quanto backend)
- Serverless Framework
- xRay

## Lambda Edge

- Criando função
- Integração à distribuição
- Origin Request
- Interceptando querystring
- Viewer Request

## SDK

- Uso em diferentes linguagens

## AWS CLI (todo orientado a Docker)

- EC2
- S3
- SQS
- ACM
- Lambda
- ECS e ECR
