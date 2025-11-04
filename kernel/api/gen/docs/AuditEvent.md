# AuditEvent

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **interface{}** |  | 
**Type** | **interface{}** |  | 
**Payload** | **interface{}** |  | 
**Ts** | **interface{}** |  | 
**PrevHash** | Pointer to **interface{}** |  | [optional] 
**Hash** | **interface{}** |  | 
**Signature** | **interface{}** |  | 

## Methods

### NewAuditEvent

`func NewAuditEvent(id interface{}, type_ interface{}, payload interface{}, ts interface{}, hash interface{}, signature interface{}, ) *AuditEvent`

NewAuditEvent instantiates a new AuditEvent object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewAuditEventWithDefaults

`func NewAuditEventWithDefaults() *AuditEvent`

NewAuditEventWithDefaults instantiates a new AuditEvent object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *AuditEvent) GetId() interface{}`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *AuditEvent) GetIdOk() (*interface{}, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *AuditEvent) SetId(v interface{})`

SetId sets Id field to given value.


### SetIdNil

`func (o *AuditEvent) SetIdNil(b bool)`

 SetIdNil sets the value for Id to be an explicit nil

### UnsetId
`func (o *AuditEvent) UnsetId()`

UnsetId ensures that no value is present for Id, not even an explicit nil
### GetType

`func (o *AuditEvent) GetType() interface{}`

GetType returns the Type field if non-nil, zero value otherwise.

### GetTypeOk

`func (o *AuditEvent) GetTypeOk() (*interface{}, bool)`

GetTypeOk returns a tuple with the Type field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetType

`func (o *AuditEvent) SetType(v interface{})`

SetType sets Type field to given value.


### SetTypeNil

`func (o *AuditEvent) SetTypeNil(b bool)`

 SetTypeNil sets the value for Type to be an explicit nil

### UnsetType
`func (o *AuditEvent) UnsetType()`

UnsetType ensures that no value is present for Type, not even an explicit nil
### GetPayload

`func (o *AuditEvent) GetPayload() interface{}`

GetPayload returns the Payload field if non-nil, zero value otherwise.

### GetPayloadOk

`func (o *AuditEvent) GetPayloadOk() (*interface{}, bool)`

GetPayloadOk returns a tuple with the Payload field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPayload

`func (o *AuditEvent) SetPayload(v interface{})`

SetPayload sets Payload field to given value.


### SetPayloadNil

`func (o *AuditEvent) SetPayloadNil(b bool)`

 SetPayloadNil sets the value for Payload to be an explicit nil

### UnsetPayload
`func (o *AuditEvent) UnsetPayload()`

UnsetPayload ensures that no value is present for Payload, not even an explicit nil
### GetTs

`func (o *AuditEvent) GetTs() interface{}`

GetTs returns the Ts field if non-nil, zero value otherwise.

### GetTsOk

`func (o *AuditEvent) GetTsOk() (*interface{}, bool)`

GetTsOk returns a tuple with the Ts field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTs

`func (o *AuditEvent) SetTs(v interface{})`

SetTs sets Ts field to given value.


### SetTsNil

`func (o *AuditEvent) SetTsNil(b bool)`

 SetTsNil sets the value for Ts to be an explicit nil

### UnsetTs
`func (o *AuditEvent) UnsetTs()`

UnsetTs ensures that no value is present for Ts, not even an explicit nil
### GetPrevHash

`func (o *AuditEvent) GetPrevHash() interface{}`

GetPrevHash returns the PrevHash field if non-nil, zero value otherwise.

### GetPrevHashOk

`func (o *AuditEvent) GetPrevHashOk() (*interface{}, bool)`

GetPrevHashOk returns a tuple with the PrevHash field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPrevHash

`func (o *AuditEvent) SetPrevHash(v interface{})`

SetPrevHash sets PrevHash field to given value.

### HasPrevHash

`func (o *AuditEvent) HasPrevHash() bool`

HasPrevHash returns a boolean if a field has been set.

### SetPrevHashNil

`func (o *AuditEvent) SetPrevHashNil(b bool)`

 SetPrevHashNil sets the value for PrevHash to be an explicit nil

### UnsetPrevHash
`func (o *AuditEvent) UnsetPrevHash()`

UnsetPrevHash ensures that no value is present for PrevHash, not even an explicit nil
### GetHash

`func (o *AuditEvent) GetHash() interface{}`

GetHash returns the Hash field if non-nil, zero value otherwise.

### GetHashOk

`func (o *AuditEvent) GetHashOk() (*interface{}, bool)`

GetHashOk returns a tuple with the Hash field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetHash

`func (o *AuditEvent) SetHash(v interface{})`

SetHash sets Hash field to given value.


### SetHashNil

`func (o *AuditEvent) SetHashNil(b bool)`

 SetHashNil sets the value for Hash to be an explicit nil

### UnsetHash
`func (o *AuditEvent) UnsetHash()`

UnsetHash ensures that no value is present for Hash, not even an explicit nil
### GetSignature

`func (o *AuditEvent) GetSignature() interface{}`

GetSignature returns the Signature field if non-nil, zero value otherwise.

### GetSignatureOk

`func (o *AuditEvent) GetSignatureOk() (*interface{}, bool)`

GetSignatureOk returns a tuple with the Signature field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSignature

`func (o *AuditEvent) SetSignature(v interface{})`

SetSignature sets Signature field to given value.


### SetSignatureNil

`func (o *AuditEvent) SetSignatureNil(b bool)`

 SetSignatureNil sets the value for Signature to be an explicit nil

### UnsetSignature
`func (o *AuditEvent) UnsetSignature()`

UnsetSignature ensures that no value is present for Signature, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


