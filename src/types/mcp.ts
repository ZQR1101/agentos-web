export type MCPStatus =
  | "connected"
  | "disconnected"
  | "error";


export interface MCPServer {

  id:string;

  name:string;

  description:string;

  status:MCPStatus;


  tools:string[];

}