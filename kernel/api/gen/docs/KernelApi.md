# \KernelApi

All URIs are relative to *http://localhost:3000*

Method | HTTP request | Description
------------- | ------------- | -------------
[**HealthGet**](KernelApi.md#HealthGet) | **Get** /health | Liveness probe
[**KernelAgentIdStateGet**](KernelApi.md#KernelAgentIdStateGet) | **Get** /kernel/agent/{id}/state | Retrieve agent snapshot and recent metrics
[**KernelAgentPost**](KernelApi.md#KernelAgentPost) | **Post** /kernel/agent | Spawn a new agent from template/manifest
[**KernelAllocatePost**](KernelApi.md#KernelAllocatePost) | **Post** /kernel/allocate | Request or assign compute / capital resources
[**KernelAuditIdGet**](KernelApi.md#KernelAuditIdGet) | **Get** /kernel/audit/{id} | Fetch a signed audit event
[**KernelDivisionIdGet**](KernelApi.md#KernelDivisionIdGet) | **Get** /kernel/division/{id} | Fetch a DivisionManifest
[**KernelDivisionPost**](KernelApi.md#KernelDivisionPost) | **Post** /kernel/division | Register or update a DivisionManifest
[**KernelEvalPost**](KernelApi.md#KernelEvalPost) | **Post** /kernel/eval | Submit an EvalReport
[**KernelReasonNodeGet**](KernelApi.md#KernelReasonNodeGet) | **Get** /kernel/reason/{node} | Retrieve a reasoning trace for a graph node
[**KernelSignPost**](KernelApi.md#KernelSignPost) | **Post** /kernel/sign | Request a signature for a manifest
[**ReadyGet**](KernelApi.md#ReadyGet) | **Get** /ready | Readiness check (DB + KMS if required)



## HealthGet

> HealthGet200Response HealthGet(ctx).Execute()

Liveness probe

### Example

```go
package main

import (
    "context"
    "fmt"
    "os"
    openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID"
)

func main() {

    configuration := openapiclient.NewConfiguration()
    apiClient := openapiclient.NewAPIClient(configuration)
    resp, r, err := apiClient.KernelApi.HealthGet(context.Background()).Execute()
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error when calling `KernelApi.HealthGet``: %v\n", err)
        fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
    }
    // response from `HealthGet`: HealthGet200Response
    fmt.Fprintf(os.Stdout, "Response from `KernelApi.HealthGet`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiHealthGetRequest struct via the builder pattern


### Return type

[**HealthGet200Response**](HealthGet200Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## KernelAgentIdStateGet

> AgentProfile KernelAgentIdStateGet(ctx, id).Execute()

Retrieve agent snapshot and recent metrics

### Example

```go
package main

import (
    "context"
    "fmt"
    "os"
    openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID"
)

func main() {
    id := TODO // interface{} | 

    configuration := openapiclient.NewConfiguration()
    apiClient := openapiclient.NewAPIClient(configuration)
    resp, r, err := apiClient.KernelApi.KernelAgentIdStateGet(context.Background(), id).Execute()
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error when calling `KernelApi.KernelAgentIdStateGet``: %v\n", err)
        fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
    }
    // response from `KernelAgentIdStateGet`: AgentProfile
    fmt.Fprintf(os.Stdout, "Response from `KernelApi.KernelAgentIdStateGet`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | [**interface{}**](.md) |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiKernelAgentIdStateGetRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**AgentProfile**](AgentProfile.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## KernelAgentPost

> KernelAgentPost202Response KernelAgentPost(ctx).KernelAgentPostRequest(kernelAgentPostRequest).Execute()

Spawn a new agent from template/manifest

### Example

```go
package main

import (
    "context"
    "fmt"
    "os"
    openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID"
)

func main() {
    kernelAgentPostRequest := *openapiclient.NewKernelAgentPostRequest(interface{}(123), interface{}(123)) // KernelAgentPostRequest | 

    configuration := openapiclient.NewConfiguration()
    apiClient := openapiclient.NewAPIClient(configuration)
    resp, r, err := apiClient.KernelApi.KernelAgentPost(context.Background()).KernelAgentPostRequest(kernelAgentPostRequest).Execute()
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error when calling `KernelApi.KernelAgentPost``: %v\n", err)
        fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
    }
    // response from `KernelAgentPost`: KernelAgentPost202Response
    fmt.Fprintf(os.Stdout, "Response from `KernelApi.KernelAgentPost`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiKernelAgentPostRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **kernelAgentPostRequest** | [**KernelAgentPostRequest**](KernelAgentPostRequest.md) |  | 

### Return type

[**KernelAgentPost202Response**](KernelAgentPost202Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## KernelAllocatePost

> KernelAllocatePost202Response KernelAllocatePost(ctx).AllocationRequest(allocationRequest).Execute()

Request or assign compute / capital resources

### Example

```go
package main

import (
    "context"
    "fmt"
    "os"
    openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID"
)

func main() {
    allocationRequest := *openapiclient.NewAllocationRequest(interface{}(123), interface{}(123)) // AllocationRequest | 

    configuration := openapiclient.NewConfiguration()
    apiClient := openapiclient.NewAPIClient(configuration)
    resp, r, err := apiClient.KernelApi.KernelAllocatePost(context.Background()).AllocationRequest(allocationRequest).Execute()
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error when calling `KernelApi.KernelAllocatePost``: %v\n", err)
        fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
    }
    // response from `KernelAllocatePost`: KernelAllocatePost202Response
    fmt.Fprintf(os.Stdout, "Response from `KernelApi.KernelAllocatePost`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiKernelAllocatePostRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **allocationRequest** | [**AllocationRequest**](AllocationRequest.md) |  | 

### Return type

[**KernelAllocatePost202Response**](KernelAllocatePost202Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## KernelAuditIdGet

> AuditEvent KernelAuditIdGet(ctx, id).Execute()

Fetch a signed audit event

### Example

```go
package main

import (
    "context"
    "fmt"
    "os"
    openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID"
)

func main() {
    id := TODO // interface{} | 

    configuration := openapiclient.NewConfiguration()
    apiClient := openapiclient.NewAPIClient(configuration)
    resp, r, err := apiClient.KernelApi.KernelAuditIdGet(context.Background(), id).Execute()
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error when calling `KernelApi.KernelAuditIdGet``: %v\n", err)
        fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
    }
    // response from `KernelAuditIdGet`: AuditEvent
    fmt.Fprintf(os.Stdout, "Response from `KernelApi.KernelAuditIdGet`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | [**interface{}**](.md) |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiKernelAuditIdGetRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**AuditEvent**](AuditEvent.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## KernelDivisionIdGet

> DivisionManifest KernelDivisionIdGet(ctx, id).Execute()

Fetch a DivisionManifest

### Example

```go
package main

import (
    "context"
    "fmt"
    "os"
    openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID"
)

func main() {
    id := TODO // interface{} | 

    configuration := openapiclient.NewConfiguration()
    apiClient := openapiclient.NewAPIClient(configuration)
    resp, r, err := apiClient.KernelApi.KernelDivisionIdGet(context.Background(), id).Execute()
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error when calling `KernelApi.KernelDivisionIdGet``: %v\n", err)
        fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
    }
    // response from `KernelDivisionIdGet`: DivisionManifest
    fmt.Fprintf(os.Stdout, "Response from `KernelApi.KernelDivisionIdGet`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | [**interface{}**](.md) |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiKernelDivisionIdGetRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**DivisionManifest**](DivisionManifest.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## KernelDivisionPost

> DivisionManifest KernelDivisionPost(ctx).DivisionManifest(divisionManifest).Execute()

Register or update a DivisionManifest

### Example

```go
package main

import (
    "context"
    "fmt"
    "os"
    openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID"
)

func main() {
    divisionManifest := *openapiclient.NewDivisionManifest(interface{}(123), interface{}(123), interface{}(123)) // DivisionManifest | 

    configuration := openapiclient.NewConfiguration()
    apiClient := openapiclient.NewAPIClient(configuration)
    resp, r, err := apiClient.KernelApi.KernelDivisionPost(context.Background()).DivisionManifest(divisionManifest).Execute()
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error when calling `KernelApi.KernelDivisionPost``: %v\n", err)
        fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
    }
    // response from `KernelDivisionPost`: DivisionManifest
    fmt.Fprintf(os.Stdout, "Response from `KernelApi.KernelDivisionPost`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiKernelDivisionPostRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **divisionManifest** | [**DivisionManifest**](DivisionManifest.md) |  | 

### Return type

[**DivisionManifest**](DivisionManifest.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## KernelEvalPost

> KernelEvalPost200Response KernelEvalPost(ctx).EvalReport(evalReport).Execute()

Submit an EvalReport

### Example

```go
package main

import (
    "context"
    "fmt"
    "os"
    openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID"
)

func main() {
    evalReport := *openapiclient.NewEvalReport(interface{}(123), interface{}(123), interface{}(123)) // EvalReport | 

    configuration := openapiclient.NewConfiguration()
    apiClient := openapiclient.NewAPIClient(configuration)
    resp, r, err := apiClient.KernelApi.KernelEvalPost(context.Background()).EvalReport(evalReport).Execute()
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error when calling `KernelApi.KernelEvalPost``: %v\n", err)
        fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
    }
    // response from `KernelEvalPost`: KernelEvalPost200Response
    fmt.Fprintf(os.Stdout, "Response from `KernelApi.KernelEvalPost`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiKernelEvalPostRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **evalReport** | [**EvalReport**](EvalReport.md) |  | 

### Return type

[**KernelEvalPost200Response**](KernelEvalPost200Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## KernelReasonNodeGet

> KernelReasonNodeGet200Response KernelReasonNodeGet(ctx, node).Execute()

Retrieve a reasoning trace for a graph node

### Example

```go
package main

import (
    "context"
    "fmt"
    "os"
    openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID"
)

func main() {
    node := TODO // interface{} | 

    configuration := openapiclient.NewConfiguration()
    apiClient := openapiclient.NewAPIClient(configuration)
    resp, r, err := apiClient.KernelApi.KernelReasonNodeGet(context.Background(), node).Execute()
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error when calling `KernelApi.KernelReasonNodeGet``: %v\n", err)
        fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
    }
    // response from `KernelReasonNodeGet`: KernelReasonNodeGet200Response
    fmt.Fprintf(os.Stdout, "Response from `KernelApi.KernelReasonNodeGet`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**node** | [**interface{}**](.md) |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiKernelReasonNodeGetRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**KernelReasonNodeGet200Response**](KernelReasonNodeGet200Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## KernelSignPost

> ManifestSignature KernelSignPost(ctx).SignRequest(signRequest).Execute()

Request a signature for a manifest

### Example

```go
package main

import (
    "context"
    "fmt"
    "os"
    openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID"
)

func main() {
    signRequest := *openapiclient.NewSignRequest(interface{}(123), interface{}(123)) // SignRequest | 

    configuration := openapiclient.NewConfiguration()
    apiClient := openapiclient.NewAPIClient(configuration)
    resp, r, err := apiClient.KernelApi.KernelSignPost(context.Background()).SignRequest(signRequest).Execute()
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error when calling `KernelApi.KernelSignPost``: %v\n", err)
        fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
    }
    // response from `KernelSignPost`: ManifestSignature
    fmt.Fprintf(os.Stdout, "Response from `KernelApi.KernelSignPost`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiKernelSignPostRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **signRequest** | [**SignRequest**](SignRequest.md) |  | 

### Return type

[**ManifestSignature**](ManifestSignature.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ReadyGet

> ReadyGet200Response ReadyGet(ctx).Execute()

Readiness check (DB + KMS if required)

### Example

```go
package main

import (
    "context"
    "fmt"
    "os"
    openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID"
)

func main() {

    configuration := openapiclient.NewConfiguration()
    apiClient := openapiclient.NewAPIClient(configuration)
    resp, r, err := apiClient.KernelApi.ReadyGet(context.Background()).Execute()
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error when calling `KernelApi.ReadyGet``: %v\n", err)
        fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
    }
    // response from `ReadyGet`: ReadyGet200Response
    fmt.Fprintf(os.Stdout, "Response from `KernelApi.ReadyGet`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiReadyGetRequest struct via the builder pattern


### Return type

[**ReadyGet200Response**](ReadyGet200Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

