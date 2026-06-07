module blockagrichain/backend

go 1.21

require (
	github.com/aws/aws-sdk-go-v2 v1.30.3
	github.com/aws/aws-sdk-go-v2/config v1.27.27
	github.com/aws/aws-sdk-go-v2/service/s3 v1.58.3
	github.com/aws/aws-sdk-go-v2/service/secretsmanager v1.32.3
	github.com/go-chi/chi/v5 v5.1.0
	github.com/go-chi/cors v1.2.1
	github.com/golang-jwt/jwt/v5 v5.2.1
	github.com/hyperledger/fabric-gateway v1.5.1
	github.com/hyperledger/fabric-protos-go-apiv2 v0.3.4
	golang.org/x/crypto v0.27.0
	google.golang.org/grpc v1.66.0
	google.golang.org/protobuf v1.34.2
	gorm.io/driver/sqlserver v1.5.4
	gorm.io/gorm v1.25.12
)
