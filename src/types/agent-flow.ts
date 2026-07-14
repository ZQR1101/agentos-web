export interface AgentNode {

 id:string;

 name:string;

 role:
 "manager"
 |
 "worker"
 |
 "reviewer";

}


export interface AgentEdge {

 from:string;

 to:string;

}


export interface AgentFlow {

 nodes:AgentNode[];

 edges:AgentEdge[];

}
