"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppConfig } from "@/types/api";
import { DEFAULT_ANALYZE_TEMPLATE, DEFAULT_SIMILAR_TEMPLATE, DEFAULT_KNOWLEDGE_TAGS_TEMPLATE } from "@/lib/ai/prompts";
import { RotateCcw, AlertTriangle, Info } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

type PromptType = 'analyze' | 'similar' | 'knowledgeTags';

const PROMPT_DEFAULTS: Record<PromptType, string> = {
    analyze: DEFAULT_ANALYZE_TEMPLATE,
    similar: DEFAULT_SIMILAR_TEMPLATE,
    knowledgeTags: DEFAULT_KNOWLEDGE_TAGS_TEMPLATE,
};

interface PromptSettingsProps {
    config: AppConfig;
    onUpdate: (type: PromptType, value: string) => void;
}

interface VariableInfoProps {
    name: string;
    description: string;
}

function VariableInfo({ name, description }: VariableInfoProps) {
    return (
        <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2 text-xs py-1">
            <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-primary shrink-0 w-fit">{`{{${name}}}`}</code>
            <span className="text-muted-foreground">{description}</span>
        </div>
    );
}

export function PromptSettings({ config, onUpdate }: PromptSettingsProps) {
    const { language, t } = useLanguage();
    const [analyzeTemplate, setAnalyzeTemplate] = useState("");
    const [similarTemplate, setSimilarTemplate] = useState("");
    const [knowledgeTagsTemplate, setKnowledgeTagsTemplate] = useState("");

    const templateState: Record<PromptType, string> = {
        analyze: analyzeTemplate,
        similar: similarTemplate,
        knowledgeTags: knowledgeTagsTemplate,
    };
    const templateSetters: Record<PromptType, (value: string) => void> = {
        analyze: setAnalyzeTemplate,
        similar: setSimilarTemplate,
        knowledgeTags: setKnowledgeTagsTemplate,
    };

    useEffect(() => {
        setAnalyzeTemplate(config.prompts?.analyze || DEFAULT_ANALYZE_TEMPLATE);
        setSimilarTemplate(config.prompts?.similar || DEFAULT_SIMILAR_TEMPLATE);
        setKnowledgeTagsTemplate(config.prompts?.knowledgeTags || DEFAULT_KNOWLEDGE_TAGS_TEMPLATE);
    }, [config.prompts]);

    const handleReset = (type: PromptType) => {
        if (!confirm(t.settings?.prompts?.resetConfirm || "Are you sure you want to reset to default?")) return;

        templateSetters[type](PROMPT_DEFAULTS[type]);
        onUpdate(type, PROMPT_DEFAULTS[type]);
    };

    const handleChange = (type: PromptType, value: string) => {
        templateSetters[type](value);
        onUpdate(type, value);
    };

    const WarningBox = () => (
        <div className="bg-amber-50 border border-amber-200 rounded-md p-3 flex items-start gap-3 text-amber-900 text-sm mb-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            <div className="space-y-1">
                <p className="font-medium">
                    {t.settings?.prompts?.caution || "Modify with Caution"}
                </p>
                <p className="text-amber-800/90 text-xs">
                    {t.settings?.prompts?.warning || "Variables in {{brackets}} are used to inject dynamic content. Please preserve these variables, otherwise the AI providing may fail to get question context or return invalid formats."}
                </p>
            </div>
        </div>
    );

    const renderTemplateTab = (type: PromptType) => {
        const varsByType: Record<PromptType, { name: string; description: string }[]> = {
            analyze: [
                { name: "language_instruction", description: t.settings?.prompts?.vars?.languageInstruction || "Injects instructions based on target language (e.g., keep English questions in English but analysis in Chinese)." },
                { name: "knowledge_points_list", description: t.settings?.prompts?.vars?.knowledgePointsList || "Injects the standard list of knowledge point tags for the specific subject." },
                { name: "provider_hints", description: t.settings?.prompts?.vars?.providerHints || "System-injected hints (e.g., enforcing JSON format)." },
            ],
            similar: [
                { name: "difficulty_level", description: t.settings?.prompts?.vars?.difficultyLevel || "Target difficulty level." },
                { name: "difficulty_instruction", description: t.settings?.prompts?.vars?.difficultyInstruction || "Specific writing instructions for the target difficulty." },
                { name: "original_question", description: t.settings?.prompts?.vars?.originalQuestion || "The full text of the original question." },
                { name: "knowledge_points", description: t.settings?.prompts?.vars?.knowledgePoints || "List of knowledge points to test." },
                { name: "language_instruction", description: t.settings?.prompts?.vars?.languageInstructionShort || "Language formatting instructions." },
            ],
            knowledgeTags: [
                { name: "subject", description: t.settings?.prompts?.vars?.subject || "Subject of the question (e.g. 数学/物理)." },
                { name: "grade_semester", description: t.settings?.prompts?.vars?.gradeSemester || "Grade and semester of the student (e.g. 八年级下)." },
                { name: "knowledge_points_list", description: t.settings?.prompts?.vars?.knowledgePointsList || "Injects the standard list of knowledge point tags for the specific subject." },
                { name: "question_text", description: t.settings?.prompts?.vars?.questionText || "The question content." },
                { name: "answer_text", description: t.settings?.prompts?.vars?.answerText || "The answer content (may be empty)." },
                { name: "analysis", description: t.settings?.prompts?.vars?.analysis || "The analysis/explanation content (may be empty)." },
            ],
        };
        const labelByType: Record<PromptType, string> = {
            analyze: t.settings?.prompts?.customAnalysis || "Custom Analysis Template",
            similar: t.settings?.prompts?.customSimilar || "Custom Similar Question Template",
            knowledgeTags: t.settings?.prompts?.customKnowledgeTags || "Custom Knowledge Tags Template",
        };

        return (
            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <Label className="text-base font-semibold">
                        {labelByType[type]}
                    </Label>
                    <Button variant="outline" size="sm" onClick={() => handleReset(type)}>
                        <RotateCcw className="w-4 h-4 mr-2" />
                        {t.settings?.prompts?.reset || "Reset Default"}
                    </Button>
                </div>

                <WarningBox />

                <div className="space-y-2 border rounded-md p-3 bg-background">
                    <h4 className="text-xs font-medium flex items-center gap-1.5 mb-2">
                        <Info className="h-3.5 w-3.5" />
                        {t.settings?.prompts?.variables || "Available Variables"}
                    </h4>
                    <div className="space-y-1.5">
                        {varsByType[type].map((v) => (
                            <VariableInfo key={v.name} name={v.name} description={v.description} />
                        ))}
                    </div>
                </div>

                <Textarea
                    value={templateState[type]}
                    onChange={(e) => handleChange(type, e.target.value)}
                    className="font-mono text-xs min-h-[400px]"
                    placeholder={PROMPT_DEFAULTS[type]}
                />
            </div>
        );
    };

    return (
        <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
            <Tabs defaultValue="analyze" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="analyze">
                        {t.settings?.prompts?.analysisTab || "Analysis Prompt"}
                    </TabsTrigger>
                    <TabsTrigger value="similar">
                        {t.settings?.prompts?.similarTab || "Similar Question Prompt"}
                    </TabsTrigger>
                    <TabsTrigger value="knowledgeTags">
                        {t.settings?.prompts?.knowledgeTagsTab || "Knowledge Tags"}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="analyze" className="space-y-4 py-4">
                    {renderTemplateTab('analyze')}
                </TabsContent>

                <TabsContent value="similar" className="space-y-4 py-4">
                    {renderTemplateTab('similar')}
                </TabsContent>

                <TabsContent value="knowledgeTags" className="space-y-4 py-4">
                    {renderTemplateTab('knowledgeTags')}
                </TabsContent>
            </Tabs>
        </div>
    );
}
