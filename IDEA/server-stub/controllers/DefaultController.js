/**
 * The DefaultController file is a very simple one, which does not need to be changed manually,
 * unless there's a case where business logic routes the request to an entity which is not
 * the service.
 * The heavy lifting of the Controller item is done in Request.js - that is where request
 * parameters are extracted and sent to the service, and where response is handled.
 */

const Controller = require('./Controller');
const service = require('../services/DefaultService');
const apiV1AgentAgentIdGET = async (request, response) => {
  await Controller.handleRequest(request, response, service.apiV1AgentAgentIdGET);
};

const apiV1AgentSavePOST = async (request, response) => {
  await Controller.handleRequest(request, response, service.apiV1AgentSavePOST);
};

const apiV1AgentStatusAgentIdGET = async (request, response) => {
  await Controller.handleRequest(request, response, service.apiV1AgentStatusAgentIdGET);
};

const apiV1GitBranchesGET = async (request, response) => {
  await Controller.handleRequest(request, response, service.apiV1GitBranchesGET);
};

const apiV1GitCommitAllPOST = async (request, response) => {
  await Controller.handleRequest(request, response, service.apiV1GitCommitAllPOST);
};

const apiV1GitCreateBranchPOST = async (request, response) => {
  await Controller.handleRequest(request, response, service.apiV1GitCreateBranchPOST);
};

const apiV1GitCurrentGET = async (request, response) => {
  await Controller.handleRequest(request, response, service.apiV1GitCurrentGET);
};

const apiV1GitOpenPOST = async (request, response) => {
  await Controller.handleRequest(request, response, service.apiV1GitOpenPOST);
};

const apiV1GitPrPOST = async (request, response) => {
  await Controller.handleRequest(request, response, service.apiV1GitPrPOST);
};

const apiV1GitPushPOST = async (request, response) => {
  await Controller.handleRequest(request, response, service.apiV1GitPushPOST);
};

const apiV1GitStatusGET = async (request, response) => {
  await Controller.handleRequest(request, response, service.apiV1GitStatusGET);
};

const apiV1KernelCallbackPOST = async (request, response) => {
  await Controller.handleRequest(request, response, service.apiV1KernelCallbackPOST);
};

const apiV1KernelSubmitPOST = async (request, response) => {
  await Controller.handleRequest(request, response, service.apiV1KernelSubmitPOST);
};

const apiV1PackageCompletePOST = async (request, response) => {
  await Controller.handleRequest(request, response, service.apiV1PackageCompletePOST);
};

const apiV1PackagePOST = async (request, response) => {
  await Controller.handleRequest(request, response, service.apiV1PackagePOST);
};

const apiV1ProfileGetGET = async (request, response) => {
  await Controller.handleRequest(request, response, service.apiV1ProfileGetGET);
};

const apiV1ProfileSetPOST = async (request, response) => {
  await Controller.handleRequest(request, response, service.apiV1ProfileSetPOST);
};

const apiV1SandboxRunPOST = async (request, response) => {
  await Controller.handleRequest(request, response, service.apiV1SandboxRunPOST);
};

const apiV1SandboxRunRunIdGET = async (request, response) => {
  await Controller.handleRequest(request, response, service.apiV1SandboxRunRunIdGET);
};

const apiV1WorkspaceCreatePOST = async (request, response) => {
  await Controller.handleRequest(request, response, service.apiV1WorkspaceCreatePOST);
};


module.exports = {
  apiV1AgentAgentIdGET,
  apiV1AgentSavePOST,
  apiV1AgentStatusAgentIdGET,
  apiV1GitBranchesGET,
  apiV1GitCommitAllPOST,
  apiV1GitCreateBranchPOST,
  apiV1GitCurrentGET,
  apiV1GitOpenPOST,
  apiV1GitPrPOST,
  apiV1GitPushPOST,
  apiV1GitStatusGET,
  apiV1KernelCallbackPOST,
  apiV1KernelSubmitPOST,
  apiV1PackageCompletePOST,
  apiV1PackagePOST,
  apiV1ProfileGetGET,
  apiV1ProfileSetPOST,
  apiV1SandboxRunPOST,
  apiV1SandboxRunRunIdGET,
  apiV1WorkspaceCreatePOST,
};
