export type CompletenessRule = {
  fieldName: string;
  label: string;
  question: string;
  minimumConfidence: number;
  allowManualConfirmation: boolean;
  allowNull?: boolean;
  conflictBlocks?: boolean;
  required: boolean;
  requiredUnlessAny?: string[];
  requiredUnlessAll?: string[];
};

export type CompletenessRuleSet = {
  id: string;
  version: string;
  label: string;
  rules: CompletenessRule[];
};

const commonRules: CompletenessRule[] = [
  { fieldName: "legal_name", label: "Полное наименование", question: "Укажите полное юридическое наименование организации.", minimumConfidence: 0.75, allowManualConfirmation: true, required: true },
  { fieldName: "inn", label: "ИНН", question: "Укажите ИНН организации.", minimumConfidence: 0.9, allowManualConfirmation: true, required: true },
  { fieldName: "legal_address", label: "Юридический адрес", question: "Укажите юридический адрес организации.", minimumConfidence: 0.75, allowManualConfirmation: true, required: true },
  { fieldName: "signer_name", label: "ФИО подписанта", question: "Укажите ФИО лица, подписывающего договор.", minimumConfidence: 0.75, allowManualConfirmation: true, required: true },
  { fieldName: "signer_position", label: "Должность подписанта", question: "Укажите должность подписанта.", minimumConfidence: 0.75, allowManualConfirmation: true, required: true },
  { fieldName: "signer_authority", label: "Основание полномочий", question: "Укажите основание полномочий подписанта.", minimumConfidence: 0.75, allowManualConfirmation: true, required: true },
  { fieldName: "contract_subject", label: "Предмет договора", question: "Уточните предмет договора.", minimumConfidence: 0.7, allowManualConfirmation: true, required: true },
  { fieldName: "contract_amount", label: "Сумма договора", question: "Укажите сумму договора.", minimumConfidence: 0.85, allowManualConfirmation: true, required: true },
  { fieldName: "currency", label: "Валюта", question: "Укажите валюту суммы договора.", minimumConfidence: 0.85, allowManualConfirmation: true, required: true },
  { fieldName: "performance_period_text", label: "Срок исполнения", question: "Укажите срок исполнения обязательств.", minimumConfidence: 0.7, allowManualConfirmation: true, required: true, requiredUnlessAll: ["performance_start_date", "performance_end_date"] },
  { fieldName: "payment_terms", label: "Условия оплаты", question: "Укажите порядок и сроки оплаты.", minimumConfidence: 0.7, allowManualConfirmation: true, required: true },
];

function withRules(
  id: string,
  version: string,
  label: string,
  additions: CompletenessRule[] = [],
): CompletenessRuleSet {
  return { id, version, label, rules: [...commonRules, ...additions] };
}

export const completenessRuleSets: CompletenessRuleSet[] = [
  withRules("standard-contract", "1.0.0", "Стандартный договор"),
  withRules("services-contract", "1.0.0", "Договор оказания услуг", [
    { fieldName: "additional_conditions", label: "Результат услуг", question: "Опишите ожидаемый результат оказания услуг.", minimumConfidence: 0.65, allowManualConfirmation: true, required: true },
  ]),
  withRules("supply-contract", "1.0.0", "Договор поставки", [
    { fieldName: "additional_conditions", label: "Условия поставки", question: "Укажите место и условия поставки.", minimumConfidence: 0.65, allowManualConfirmation: true, required: true },
  ]),
];

export function getRuleSet(id: string): CompletenessRuleSet {
  const ruleSet = completenessRuleSets.find((item) => item.id === id);
  if (!ruleSet) throw new Error("Unknown completeness rule set.");
  return ruleSet;
}
