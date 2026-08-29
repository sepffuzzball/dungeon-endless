export function retirementConfirmed(
	characterName: string,
	confirmationName: string | null,
	confirmed: boolean
): boolean {
	return confirmed && confirmationName === characterName;
}
