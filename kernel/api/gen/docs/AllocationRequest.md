# AllocationRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **interface{}** |  | 
**DivisionId** | **interface{}** |  | 
**Cpu** | Pointer to **interface{}** |  | [optional] 
**Gpu** | Pointer to **interface{}** |  | [optional] 
**MemoryMB** | Pointer to **interface{}** |  | [optional] 
**Requester** | Pointer to **interface{}** |  | [optional] 

## Methods

### NewAllocationRequest

`func NewAllocationRequest(id interface{}, divisionId interface{}, ) *AllocationRequest`

NewAllocationRequest instantiates a new AllocationRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewAllocationRequestWithDefaults

`func NewAllocationRequestWithDefaults() *AllocationRequest`

NewAllocationRequestWithDefaults instantiates a new AllocationRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *AllocationRequest) GetId() interface{}`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *AllocationRequest) GetIdOk() (*interface{}, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *AllocationRequest) SetId(v interface{})`

SetId sets Id field to given value.


### SetIdNil

`func (o *AllocationRequest) SetIdNil(b bool)`

 SetIdNil sets the value for Id to be an explicit nil

### UnsetId
`func (o *AllocationRequest) UnsetId()`

UnsetId ensures that no value is present for Id, not even an explicit nil
### GetDivisionId

`func (o *AllocationRequest) GetDivisionId() interface{}`

GetDivisionId returns the DivisionId field if non-nil, zero value otherwise.

### GetDivisionIdOk

`func (o *AllocationRequest) GetDivisionIdOk() (*interface{}, bool)`

GetDivisionIdOk returns a tuple with the DivisionId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDivisionId

`func (o *AllocationRequest) SetDivisionId(v interface{})`

SetDivisionId sets DivisionId field to given value.


### SetDivisionIdNil

`func (o *AllocationRequest) SetDivisionIdNil(b bool)`

 SetDivisionIdNil sets the value for DivisionId to be an explicit nil

### UnsetDivisionId
`func (o *AllocationRequest) UnsetDivisionId()`

UnsetDivisionId ensures that no value is present for DivisionId, not even an explicit nil
### GetCpu

`func (o *AllocationRequest) GetCpu() interface{}`

GetCpu returns the Cpu field if non-nil, zero value otherwise.

### GetCpuOk

`func (o *AllocationRequest) GetCpuOk() (*interface{}, bool)`

GetCpuOk returns a tuple with the Cpu field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCpu

`func (o *AllocationRequest) SetCpu(v interface{})`

SetCpu sets Cpu field to given value.

### HasCpu

`func (o *AllocationRequest) HasCpu() bool`

HasCpu returns a boolean if a field has been set.

### SetCpuNil

`func (o *AllocationRequest) SetCpuNil(b bool)`

 SetCpuNil sets the value for Cpu to be an explicit nil

### UnsetCpu
`func (o *AllocationRequest) UnsetCpu()`

UnsetCpu ensures that no value is present for Cpu, not even an explicit nil
### GetGpu

`func (o *AllocationRequest) GetGpu() interface{}`

GetGpu returns the Gpu field if non-nil, zero value otherwise.

### GetGpuOk

`func (o *AllocationRequest) GetGpuOk() (*interface{}, bool)`

GetGpuOk returns a tuple with the Gpu field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetGpu

`func (o *AllocationRequest) SetGpu(v interface{})`

SetGpu sets Gpu field to given value.

### HasGpu

`func (o *AllocationRequest) HasGpu() bool`

HasGpu returns a boolean if a field has been set.

### SetGpuNil

`func (o *AllocationRequest) SetGpuNil(b bool)`

 SetGpuNil sets the value for Gpu to be an explicit nil

### UnsetGpu
`func (o *AllocationRequest) UnsetGpu()`

UnsetGpu ensures that no value is present for Gpu, not even an explicit nil
### GetMemoryMB

`func (o *AllocationRequest) GetMemoryMB() interface{}`

GetMemoryMB returns the MemoryMB field if non-nil, zero value otherwise.

### GetMemoryMBOk

`func (o *AllocationRequest) GetMemoryMBOk() (*interface{}, bool)`

GetMemoryMBOk returns a tuple with the MemoryMB field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMemoryMB

`func (o *AllocationRequest) SetMemoryMB(v interface{})`

SetMemoryMB sets MemoryMB field to given value.

### HasMemoryMB

`func (o *AllocationRequest) HasMemoryMB() bool`

HasMemoryMB returns a boolean if a field has been set.

### SetMemoryMBNil

`func (o *AllocationRequest) SetMemoryMBNil(b bool)`

 SetMemoryMBNil sets the value for MemoryMB to be an explicit nil

### UnsetMemoryMB
`func (o *AllocationRequest) UnsetMemoryMB()`

UnsetMemoryMB ensures that no value is present for MemoryMB, not even an explicit nil
### GetRequester

`func (o *AllocationRequest) GetRequester() interface{}`

GetRequester returns the Requester field if non-nil, zero value otherwise.

### GetRequesterOk

`func (o *AllocationRequest) GetRequesterOk() (*interface{}, bool)`

GetRequesterOk returns a tuple with the Requester field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRequester

`func (o *AllocationRequest) SetRequester(v interface{})`

SetRequester sets Requester field to given value.

### HasRequester

`func (o *AllocationRequest) HasRequester() bool`

HasRequester returns a boolean if a field has been set.

### SetRequesterNil

`func (o *AllocationRequest) SetRequesterNil(b bool)`

 SetRequesterNil sets the value for Requester to be an explicit nil

### UnsetRequester
`func (o *AllocationRequest) UnsetRequester()`

UnsetRequester ensures that no value is present for Requester, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


