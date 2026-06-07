// Package secrets — memuat konfigurasi rahasia dari AWS Secrets Manager.
// Rahasia disimpan sebagai SecretString berisi JSON object key->value, mis:
//
//	{
//	  "DATABASE_URL": "sqlserver://app:Xxxx@blockagri.rds.amazonaws.com:1433?database=blockagri",
//	  "JWT_KEY": "rahasia-kuat-min-32-karakter",
//	  "S3_BUCKET": "blockagri-uploads"
//	}
//
// Di EC2/ECS gunakan IAM role dengan izin secretsmanager:GetSecretValue —
// tidak perlu .env / kredensial statis.
package secrets

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
)

// Fetch — ambil secret (by name/ARN) dan parse JSON map[string]string.
func Fetch(ctx context.Context, region, secretID string) (map[string]string, error) {
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("load AWS config: %w", err)
	}
	cl := secretsmanager.NewFromConfig(cfg)
	out, err := cl.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{
		SecretId: aws.String(secretID),
	})
	if err != nil {
		return nil, err
	}
	if out.SecretString == nil {
		return nil, fmt.Errorf("secret %q kosong / bukan SecretString", secretID)
	}
	m := map[string]string{}
	if err := json.Unmarshal([]byte(*out.SecretString), &m); err != nil {
		return nil, fmt.Errorf("secret %q bukan JSON object key->value: %w", secretID, err)
	}
	return m, nil
}
