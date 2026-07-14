import { Skill } from "@/types/skill";


interface Props {

 skill:Skill;

}


export default function SkillCard({
 skill
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
{skill.name}
</h2>


<p>
{skill.description}
</p>


<h3>
Tools:
</h3>


<ul>

{
skill.tools.map(tool=>(

<li key={tool}>
{tool}
</li>

))
}

</ul>


<h3>
Workflow:
</h3>


<ol>

{
skill.steps.map((step,index)=>(

<li key={index}>
{step}
</li>

))
}

</ol>


<p>
Status:
{
skill.enabled
?
"Enabled"
:
"Disabled"
}
</p>


</div>

)

}