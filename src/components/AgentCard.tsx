import { Agent } from "@/types/agent";


interface Props {

 agent:Agent;

}


export default function AgentCard({
 agent
}:Props){


return (

<div
className="
border
rounded
p-4
"
>

<h2>
{agent.name}
</h2>


<p>
Role:
{agent.role}
</p>


<p>
{agent.description}
</p>


<h3>
Skills:
</h3>


<ul>

{
agent.skills.map(skill=>(

<li key={skill}>
{skill}
</li>

))
}

</ul>


<p>
Status:
{
agent.enabled
?
"Active"
:
"Disabled"
}
</p>


</div>

)

}