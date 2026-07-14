"use client";

import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
} from "reactflow";

import "reactflow/dist/style.css";


const nodes: Node[] = [

{
 id:"manager",
 position:{
  x:300,
  y:50
 },
 data:{
  label:"Manager Agent"
 }
},


{
 id:"research",
 position:{
  x:100,
  y:200
 },
 data:{
  label:"Research Agent"
 }
},


{
 id:"coding",
 position:{
  x:500,
  y:200
 },
 data:{
  label:"Coding Agent"
 }
},


{
 id:"reviewer",
 position:{
  x:300,
  y:350
 },
 data:{
  label:"Reviewer Agent"
 }
}

];


const edges: Edge[]=[


{
 id:"e1",
 source:"manager",
 target:"research"
},


{
 id:"e2",
 source:"manager",
 target:"coding"
},


{
 id:"e3",
 source:"research",
 target:"reviewer"
},


{
 id:"e4",
 source:"coding",
 target:"reviewer"
}


];


export default function AgentGraph(){


return (

<div
style={{
height:600,
width:"100%"
}}
>

<ReactFlow

nodes={nodes}

edges={edges}

fitView

>

<Background />
<Controls />
</ReactFlow>
</div>

)

}
