// roleManagement.ts

import { roles } from './authentication';

const userRoles = {};

function assignRole(userId, role) {
  if (role in roles) {
    userRoles[userId] = role;
  }
}

function checkRole(userId, role) {
  return userRoles[userId] === role;
}

export { assignRole, checkRole };