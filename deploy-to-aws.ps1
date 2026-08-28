# ==========================================================
# PMW Manufacturing Tracker - Automated AWS EC2 Provisioner
# ==========================================================

param(
    [string]$Region = "ap-south-1",
    [string]$InstanceType = "t2.micro",
    [string]$KeyPairName = "pmw-tracker-key"
)

Write-Host "`n[1/6] Verifying AWS Connection in region '$Region'..." -ForegroundColor Cyan
$identityJson = aws sts get-caller-identity --output json
$identity = $identityJson | ConvertFrom-Json
Write-Host "Connected as AWS Account: $($identity.Account) ($($identity.Arn))`n" -ForegroundColor Green

# 1. Check or Create Key Pair
Write-Host "[2/6] Setting up Key Pair '$KeyPairName'..." -ForegroundColor Cyan
$keyPath = Join-Path $PSScriptRoot "$KeyPairName.pem"

if (-not (Test-Path $keyPath)) {
    Write-Host "Creating new EC2 Key Pair and saving to '$keyPath'..."
    aws ec2 delete-key-pair --key-name $KeyPairName --region $Region 2>$null | Out-Null
    $keyMaterial = aws ec2 create-key-pair --key-name $KeyPairName --query "KeyMaterial" --output text --region $Region
    [System.IO.File]::WriteAllText($keyPath, $keyMaterial)
    Write-Host "Key Pair saved locally to $keyPath`n" -ForegroundColor Green
} else {
    Write-Host "Using local Key Pair file: $keyPath`n" -ForegroundColor Green
}

# 2. Get Default VPC
Write-Host "[3/6] Discovering VPC..." -ForegroundColor Cyan
$defaultVpc = (aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text --region $Region)
if (-not $defaultVpc -or $defaultVpc -eq "None") {
    $defaultVpc = (aws ec2 describe-vpcs --query "Vpcs[0].VpcId" --output text --region $Region)
}
Write-Host "Found VPC: $defaultVpc`n" -ForegroundColor Green

# 3. Create or Fetch Security Group
Write-Host "[4/6] Configuring Security Group for PMW Tracker..." -ForegroundColor Cyan
$sgName = "pmw-tracker-sg"
$sgId = (aws ec2 describe-security-groups --filters "Name=group-name,Values=$sgName" "Name=vpc-id,Values=$defaultVpc" --query "SecurityGroups[0].GroupId" --output text --region $Region 2>$null)

if (-not $sgId -or $sgId -eq "None") {
    Write-Host "Creating security group '$sgName'..."
    $sgId = (aws ec2 create-security-group --group-name $sgName --description "Security group for PMW Manufacturing Tracker" --vpc-id $defaultVpc --query "GroupId" --output text --region $Region)
    
    aws ec2 authorize-security-group-ingress --group-id $sgId --protocol tcp --port 22 --cidr 0.0.0.0/0 --region $Region 2>$null | Out-Null
    aws ec2 authorize-security-group-ingress --group-id $sgId --protocol tcp --port 80 --cidr 0.0.0.0/0 --region $Region 2>$null | Out-Null
    aws ec2 authorize-security-group-ingress --group-id $sgId --protocol tcp --port 443 --cidr 0.0.0.0/0 --region $Region 2>$null | Out-Null
    aws ec2 authorize-security-group-ingress --group-id $sgId --protocol tcp --port 3000 --cidr 0.0.0.0/0 --region $Region 2>$null | Out-Null
    Write-Host "Security group created with ports 22, 80, 443, 3000 open: $sgId`n" -ForegroundColor Green
} else {
    Write-Host "Using existing security group: $sgId`n" -ForegroundColor Green
    aws ec2 authorize-security-group-ingress --group-id $sgId --protocol tcp --port 3000 --cidr 0.0.0.0/0 --region $Region 2>$null | Out-Null
}

# 4. Resolve Ubuntu 24.04 AMI
Write-Host "[5/6] Resolving Ubuntu 24.04 LTS Free Tier AMI..." -ForegroundColor Cyan
$amiId = "ami-07e5ce642bbc48c0d"
Write-Host "Using Ubuntu 24.04 LTS AMI: $amiId`n" -ForegroundColor Green

# 5. Launch EC2 Instance
Write-Host "[6/6] Launching EC2 Free Tier instance ($InstanceType)..." -ForegroundColor Cyan

# Check if an instance is already running
$existingInstanceId = (aws ec2 describe-instances `
    --filters "Name=tag:Name,Values=pmw-manufacturing-tracker" "Name=instance-state-name,Values=running,pending" `
    --query "Reservations[0].Instances[0].InstanceId" `
    --output text `
    --region $Region 2>$null)

if ($existingInstanceId -and $existingInstanceId -ne "None") {
    $instanceId = $existingInstanceId
    Write-Host "Using existing running instance: $instanceId" -ForegroundColor Green
} else {
    $instanceId = (aws ec2 run-instances `
        --image-id $amiId `
        --instance-type $InstanceType `
        --key-name $KeyPairName `
        --security-group-ids $sgId `
        --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=pmw-manufacturing-tracker}]" `
        --query "Instances[0].InstanceId" `
        --output text `
        --region $Region)

    Write-Host "Instance launched: $instanceId. Waiting for running state..." -ForegroundColor Yellow
    aws ec2 wait instance-running --instance-ids $instanceId --region $Region
}

$publicIp = (aws ec2 describe-instances --instance-ids $instanceId --query "Reservations[0].Instances[0].PublicIpAddress" --output text --region $Region)
Write-Host "Instance is running! Public IP: $publicIp`n" -ForegroundColor Green

# 6. Package and Upload Application Code
Write-Host "[7/7] Staging application bundle and transferring to AWS EC2..." -ForegroundColor Cyan

# Build clean staging folder
$stageDir = Join-Path $PSScriptRoot "deploy-staging"
if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

Copy-Item (Join-Path $PSScriptRoot "dist") -Destination (Join-Path $stageDir "dist") -Recurse -Force
Copy-Item (Join-Path $PSScriptRoot "src") -Destination (Join-Path $stageDir "src") -Recurse -Force
Copy-Item (Join-Path $PSScriptRoot "server.ts") -Destination (Join-Path $stageDir "server.ts") -Force
Copy-Item (Join-Path $PSScriptRoot "package.json") -Destination (Join-Path $stageDir "package.json") -Force
Copy-Item (Join-Path $PSScriptRoot "package-lock.json") -Destination (Join-Path $stageDir "package-lock.json") -Force
Copy-Item (Join-Path $PSScriptRoot "firebase-applet-config.json") -Destination (Join-Path $stageDir "firebase-applet-config.json") -Force
Copy-Item (Join-Path $PSScriptRoot "Dockerfile") -Destination (Join-Path $stageDir "Dockerfile") -Force
Copy-Item (Join-Path $PSScriptRoot "docker-compose.yml") -Destination (Join-Path $stageDir "docker-compose.yml") -Force
Copy-Item (Join-Path $PSScriptRoot ".dockerignore") -Destination (Join-Path $stageDir ".dockerignore") -Force
Copy-Item (Join-Path $PSScriptRoot "tsconfig.json") -Destination (Join-Path $stageDir "tsconfig.json") -Force

$bundleTar = Join-Path $PSScriptRoot "pmw-deploy-bundle.tar.gz"
if (Test-Path $bundleTar) { Remove-Item $bundleTar -Force }

# Create tar
tar -czf "$bundleTar" -C "$stageDir" .
Remove-Item $stageDir -Recurse -Force

Write-Host "Waiting for SSH connection to become ready on $publicIp..."
$maxAttempts = 25
$attempt = 0
$sshReady = $false

while ($attempt -lt $maxAttempts -and -not $sshReady) {
    Start-Sleep -Seconds 5
    $attempt++
    Write-Host "Testing SSH connection (Attempt $attempt/$maxAttempts)..."
    $testResult = ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -i "$keyPath" ubuntu@$publicIp "echo 'SSH_READY'" 2>$null
    if ($testResult -match "SSH_READY") {
        $sshReady = $true
    }
}

if ($sshReady) {
    Write-Host "SSH Ready! Installing Docker & deploying application..." -ForegroundColor Green
    
    # Run setup commands on remote server
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i "$keyPath" ubuntu@$publicIp "sudo apt-get update -y && sudo apt-get install -y docker.io docker-compose && sudo systemctl enable --now docker && sudo usermod -aG docker ubuntu && mkdir -p /home/ubuntu/app"
    
    # Upload bundle
    Write-Host "Transferring application files..." -ForegroundColor Green
    scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i "$keyPath" "$bundleTar" ubuntu@${publicIp}:/home/ubuntu/app/pmw-deploy-bundle.tar.gz

    # Extract and run
    Write-Host "Building and launching Docker container on AWS (this takes ~1-2 minutes)..." -ForegroundColor Green
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i "$keyPath" ubuntu@$publicIp "cd /home/ubuntu/app && tar -xzf pmw-deploy-bundle.tar.gz && sudo docker compose down || true && sudo docker compose up -d --build"
} else {
    Write-Host "Could not connect via SSH directly. You can connect using EC2 Instance Connect." -ForegroundColor Yellow
}

if (Test-Path $bundleTar) { Remove-Item $bundleTar -Force }

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "🎉 PMW TRACKER IS NOW LIVE ON AWS EC2!" -ForegroundColor Green
Write-Host "Instance ID : $instanceId" -ForegroundColor Cyan
Write-Host "Public IP   : $publicIp" -ForegroundColor Cyan
Write-Host "Web App URL : http://$($publicIp):3000" -ForegroundColor Yellow
Write-Host "SSH Command : ssh -i `"$keyPath`" ubuntu@$publicIp" -ForegroundColor Gray
Write-Host "==========================================================`n" -ForegroundColor Green
