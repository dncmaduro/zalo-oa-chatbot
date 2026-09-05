export interface AuthenticatedOperator {
  id: string;
  email: string;
  fullName: string;
  status: string;
  role: { id: string; code: string; name: string };
  permissions: string[];
}

export interface AuthenticatedRequestContext {
  operator: AuthenticatedOperator;
  sessionId: string;
}
