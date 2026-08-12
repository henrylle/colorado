# Computação na Formação AWS: EC2, Launch Template e Auto Scaling

Este documento lista o que a Formação AWS ensina sobre computação em máquinas
virtuais na AWS, do primeiro acesso à conta até escalar automaticamente.

## Introdução e criação da conta

- Free Tier
- Cobrança
- Serviço compartilhado x dedicado
- AZs e regiões

## Fundamentos e Tela Preta

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
- Spot, Reserva e Créditos
- AMI, EBS, Elastic IP
- SSM, SSH, EC2 Instance Connect, EC2 Instance Connect Endpoint

## Launch Template

- Tipo de instância, security group, storage, profile
- Integração com ASG
- AMI base
- Shell script (Linux) e PowerShell (Windows)
- userdata

## Auto Scaling Group

- Lançando instâncias
- Comunicação com outros serviços
- Escalando com base em métricas (CPU, fila, schedule)
- Estratégias para redução de custo e elasticidade
- Capacity Provider com ECS
- Estratégia de scaling com Spot Instance (em breve)
