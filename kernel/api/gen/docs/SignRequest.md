# SignRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Manifest** | **interface{}** |  | 
**SignerId** | **interface{}** |  | 

## Methods

### NewSignRequest

`func NewSignRequest(manifest interface{}, signerId interface{}, ) *SignRequest`

NewSignRequest instantiates a new SignRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSignRequestWithDefaults

`func NewSignRequestWithDefaults() *SignRequest`

NewSignRequestWithDefaults instantiates a new SignRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetManifest

`func (o *SignRequest) GetManifest() interface{}`

GetManifest returns the Manifest field if non-nil, zero value otherwise.

### GetManifestOk

`func (o *SignRequest) GetManifestOk() (*interface{}, bool)`

GetManifestOk returns a tuple with the Manifest field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetManifest

`func (o *SignRequest) SetManifest(v interface{})`

SetManifest sets Manifest field to given value.


### SetManifestNil

`func (o *SignRequest) SetManifestNil(b bool)`

 SetManifestNil sets the value for Manifest to be an explicit nil

### UnsetManifest
`func (o *SignRequest) UnsetManifest()`

UnsetManifest ensures that no value is present for Manifest, not even an explicit nil
### GetSignerId

`func (o *SignRequest) GetSignerId() interface{}`

GetSignerId returns the SignerId field if non-nil, zero value otherwise.

### GetSignerIdOk

`func (o *SignRequest) GetSignerIdOk() (*interface{}, bool)`

GetSignerIdOk returns a tuple with the SignerId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSignerId

`func (o *SignRequest) SetSignerId(v interface{})`

SetSignerId sets SignerId field to given value.


### SetSignerIdNil

`func (o *SignRequest) SetSignerIdNil(b bool)`

 SetSignerIdNil sets the value for SignerId to be an explicit nil

### UnsetSignerId
`func (o *SignRequest) UnsetSignerId()`

UnsetSignerId ensures that no value is present for SignerId, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


