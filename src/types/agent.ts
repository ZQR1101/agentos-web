export type AgentRole =
  | "manager"
  | "worker"
  | "reviewer";


export interface Agent {

  id:string;

  name:string;

  role:AgentRole;


  description:string;


  skills:string[];


  enabled:boolean;

}